"""DU Meet · Saathi, the AI friend who joins your call (Google Gemini).

Two ways of talking to Gemini, both with the key kept here on the server:

* Voice (Gemini Live API): the browser asks for a short-lived, single-use token and
  talks to Gemini directly over a WebSocket, so audio never passes through this server.
  The system instruction (who you are, what Saathi remembers, both sides of a Faisla)
  is built here and handed over with the token.
* Text (generateContent): verdict cards, softening a message, the short note Saathi
  keeps after every conversation, diary pages and study-break quizzes.

Saathi's memory lives in the server-only collection "ai" (the browser can't read it
through /api/data): "about" (what you told it), "consent", notes "n-…", Faisla cases
"c-…", promises "p-…" and diary pages "d-YYYY-MM-DD"
(days are India time). Everything can be wiped with one call (forget()).
"""

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://generativelanguage.googleapis.com/v1beta"
LIVE_MODEL = os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.8-live")
TEXT_MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-3.8-flash")
VOICES = ("Aoede", "Kore", "Puck", "Charon", "Leda", "Fenrir")
C = "ai"
IST = timezone(timedelta(hours=5, minutes=30))
MOODS = ("😍", "😊", "😌", "😴", "😢", "😤")


def day_of(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time(), IST).strftime("%Y-%m-%d")


def days_back(n):
    return (datetime.now(IST) - timedelta(days=n)).strftime("%Y-%m-%d")

MODES = {
    "talk": "Just talk",
    "faisla": "Faisla",
    "game": "Game host",
    "date": "Plan a date",
    "story": "Bedtime story",
}


def key():
    return os.environ.get("GEMINI_API_KEY", "").strip()


class Limit:
    """At most `count` calls per hour (Gemini costs money; a stuck loop shouldn't)."""

    def __init__(self, count):
        self.count, self.times, self.lock = count, [], threading.Lock()

    def ok(self):
        with self.lock:
            now = time.time()
            self.times = [t for t in self.times if now - t < 3600]
            if len(self.times) >= self.count:
                return False
            self.times.append(now)
            return True


TOKENS = Limit(40)
TEXTS = Limit(150)


class Saathi:
    def __init__(self, store, tls):
        self.store, self.tls = store, tls
        self._health = ("checking", 0.0)
        self._checking = False
        self.lock = threading.Lock()
        self._mcache = ([], 0.0)

    def health(self):
        """Short status for /healthz: is the key accepted and do both models exist?
        Checked in the background at most every 10 minutes; never shows the key."""
        if not key():
            return "no key"
        if time.time() - self._health[1] > 600 and not self._checking:
            self._checking = True
            threading.Thread(target=self._check, daemon=True).start()
        return self._health[0]

    def _check(self):
        status = "ready"
        for model in (LIVE_MODEL, TEXT_MODEL):
            request = urllib.request.Request(f"{API}/models/{model}", headers={"x-goog-api-key": key()})
            try:
                urllib.request.urlopen(request, timeout=8, context=self.tls).close()
            except urllib.error.HTTPError as error:
                status = f"model {model} not found" if error.code == 404 else \
                    "key not accepted" if error.code in (400, 401, 403) else f"google error {error.code}"
                break
            except (urllib.error.URLError, OSError):
                status = "can't reach google"
                break
        self._health = (status, time.time())
        self._checking = False

    # ---------- Gemini ----------

    def _post(self, url, body, timeout=40):
        request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
            "Content-Type": "application/json", "x-goog-api-key": key()})
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=self.tls) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read()[:300].decode("utf-8", "replace")
            print(f"Gemini error {error.code}: {detail}")
            raise ValueError(f"Gemini said {error.code}") from error

    def token(self):
        now = datetime.now(timezone.utc)
        stamp = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
        data = self._post(f"{API}/auth_tokens", {
            "uses": 1,
            "expireTime": stamp(now + timedelta(minutes=30)),
            "newSessionExpireTime": stamp(now + timedelta(minutes=2)),
        }, timeout=15)
        if not data.get("name"):
            raise ValueError("Gemini gave no token")
        return data["name"]

    def ask(self, system, prompt, as_json=True, temperature=0.6, image=None):
        parts = [{"inlineData": {"mimeType": "image/jpeg", "data": image}}] if image else []
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts + [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if as_json:
            body["generationConfig"]["responseMimeType"] = "application/json"
        data = self._post(f"{API}/models/{TEXT_MODEL}:generateContent", body)
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        if not as_json:
            return text
        try:
            return json.loads(text.strip("`").removeprefix("json").strip())
        except ValueError as error:
            raise ValueError("Gemini's answer wasn't readable") from error

    # ---------- memory ----------

    def _get(self, doc_id):
        try:
            doc = self.store.get(C, doc_id)
        except Exception:  # noqa: BLE001
            return {}
        return (doc or {}).get("data") or {}

    def _docs(self, prefix):
        try:
            docs = [d for d in self.store.list(C) if d["id"].startswith(prefix)]
        except Exception:  # noqa: BLE001
            return []
        return sorted(docs, key=lambda d: d["id"])

    def about(self):
        about = self._get("about")
        return {
            "aiName": str(about.get("aiName") or "Saathi")[:24],
            "voice": about.get("voice") if about.get("voice") in VOICES else "Aoede",
            "story": str(about.get("story", ""))[:1500],
            "likes": str(about.get("likes", ""))[:1500],
            "jokes": str(about.get("jokes", ""))[:1500],
            "careful": str(about.get("careful", ""))[:1500],
        }

    def save_about(self, data):
        about = self.about()
        for field in about:
            if isinstance(data.get(field), str):
                about[field] = data[field].strip()
        if about["voice"] not in VOICES:
            about["voice"] = "Aoede"
        about["aiName"] = about["aiName"][:24] or "Saathi"
        self.store.put(C, "about", about)
        return about

    def consent(self):
        return self._get("consent").get("names", {})

    def set_consent(self, name, ok):
        names = self.consent()
        if ok:
            names[name] = int(time.time())
        else:
            names.pop(name, None)
        self.store.put(C, "consent", {"names": names})
        return names

    def notes(self, limit=12):
        return [d["data"] for d in self._docs("n-")][-limit:]

    def add_note(self, text):
        if text:
            self.store.put(C, f"n-{int(time.time() * 1000)}", {"text": str(text)[:600], "at": int(time.time())})

    def cases(self):
        return [{"id": d["id"], **d["data"]} for d in self._docs("c-")]

    def case(self, case_id):
        data = self._get(case_id) if str(case_id).startswith("c-") else {}
        return {"id": case_id, **data} if data else None

    def put_case(self, case):
        data = {k: v for k, v in case.items() if k != "id"}
        self.store.put(C, case["id"], data)
        return case

    def promises(self):
        return [{"id": d["id"], **d["data"]} for d in self._docs("p-")][-30:]

    def forget(self):
        for doc in self._docs(""):
            self.store.delete(C, doc["id"])

    def state(self):
        return {
            "enabled": bool(key()),
            "about": self.about(),
            "consent": self.consent(),
            "modes": MODES,
            "voices": VOICES,
            "notes": len(self._docs("n-")),
            "cases": [self._case_card(c) for c in self.cases()][-20:],
            "promises": [p for p in self.promises() if not p.get("done")],
        }

    @staticmethod
    def _case_card(case):
        """What both may see about a case: sides stay hidden until the verdict."""
        card = {k: case.get(k) for k in ("id", "topic", "by", "at", "status", "verdict", "follow", "followAt")}
        sides = case.get("sides") or {}
        card["sidesIn"] = sorted(sides)
        if case.get("status") == "done":
            card["sides"] = sides
        return card

    def consented(self, names):
        consent = self.consent()
        return bool(names) and all(n in consent for n in names)

    # ---------- our diary: one page per day ----------

    def _meetings(self):
        if time.time() - self._mcache[1] > 60:
            try:
                self._mcache = ([d.get("data") or {} for d in self.store.list("meetings")], time.time())
            except Exception:  # noqa: BLE001
                pass
        return self._mcache[0]

    def _days(self, since):
        """Everything that happened per day since `since` (a YYYY-MM-DD string)."""
        days = {}
        get = lambda d: days.setdefault(d, {"calls": [], "notes": [], "promises": [], "page": {}})  # noqa: E731
        for m in self._meetings():
            if m.get("start") and len({p.get("name") for p in m.get("people", [])}) >= 2 and day_of(m["start"]) >= since:
                get(day_of(m["start"]))["calls"].append(m)
        for n in self.notes(limit=400):
            if day_of(n.get("at", 0)) >= since:
                get(day_of(n["at"]))["notes"].append(n.get("text", ""))
        for p in self.promises():
            if day_of(p.get("at", 0)) >= since:
                get(day_of(p["at"]))["promises"].append(p)
        for doc in self._docs("d-"):
            if doc["id"][2:] >= since:
                get(doc["id"][2:])["page"] = doc["data"]
        return days

    @staticmethod
    def _sig(m):
        page = m["page"]
        parts = [len(m["calls"]), sum(int(c.get("secs", 0)) for c in m["calls"]) // 600,
                 sum(len(c.get("chat", [])) for c in m["calls"]) // 10, len(m["notes"]), len(m["promises"]),
                 page.get("lines"), page.get("study")]
        return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:12]

    def _page(self, day, m, name):
        page = m["page"]
        secs = sum(int(c.get("secs", 0)) for c in m["calls"])
        return {
            "day": day, "calls": len(m["calls"]), "secs": secs,
            "lines": page.get("lines") or {}, "study": page.get("study") or {},
            "promises": [p.get("what", "") for p in m["promises"]][:5],
            "entry": page.get("entry"),
            "stale": bool(key()) and day >= days_back(3) and page.get("sig") != self._sig(m),
        }

    def diary(self, name):
        days = self._days(days_back(60))
        pages = []
        for day in sorted(days, reverse=True):
            m = days[day]
            if m["page"].get("hidden"):
                continue
            if not (m["calls"] or m["page"].get("lines") or m["page"].get("study")):
                continue
            pages.append(self._page(day, m, name))
        return {"pages": pages[:40]}

    def diary_write(self, day, name):
        if not (days_back(3) <= day <= day_of()):
            raise ValueError("Only the last few days can be written")
        m = self._days(day).get(day)
        if not m:
            raise ValueError("Nothing happened that day yet")
        chat = [c for call in m["calls"] for c in call.get("chat", []) if c.get("text")]
        people = sorted({p.get("name") for c in m["calls"] for p in c.get("people", [])}
                        | set(m["page"].get("lines") or {}))
        people = [p for p in people if p]
        if not self.consented(people):
            raise ValueError(f"{' and '.join(people)} need to agree to Saathi first (open Saathi in a call)")
        secs = sum(int(c.get("secs", 0)) for c in m["calls"])
        when = datetime.strptime(day, "%Y-%m-%d").strftime("%A, %d %B")
        facts = [f"Date: {when}", f"People: {', '.join(people)}"]
        if m["calls"]:
            facts.append(f"Video calls: {len(m['calls'])}, together {secs // 60} minutes in all.")
        for who, line in (m["page"].get("lines") or {}).items():
            facts.append(f"{who} wrote about the day (mood {line.get('mood', '')}): {line.get('text', '')}")
        if chat:
            facts.append("Chat messages during the calls (oldest first):")
            facts += [f"{c.get('name', '')}: {str(c['text'])[:200]}" for c in chat[-60:]]
        if m["notes"]:
            facts.append("What Saathi noted from conversations: " + " | ".join(m["notes"]))
        if m["promises"]:
            facts.append("Promises: " + "; ".join(f"{p.get('who', '')}: {p.get('what', '')}" for p in m["promises"]))
        for who, st in (m["page"].get("study") or {}).items():
            facts.append(f"{who} studied {st.get('mins', 0)} minutes" + (f" on {st['topic']}" if st.get("topic") else "")
                         + (f", quiz {st.get('right', 0)}/{st.get('total', 0)}" if st.get("total") else ""))
        ai = self.about()["aiName"]
        entry = self.ask(
            f"You are {ai}, the warm, funny best friend of {' and '.join(people)}, writing today's page in their shared "
            "diary. Write 3 to 5 sentences in natural Hinglish (Latin letters), past tense, like a friend fondly "
            "summing up their day together: specific details, a little gentle humour, no lecture. Use ONLY the facts "
            "given; never invent events. If there was a fight, mention it softly and end hopeful. Keep anything "
            "intimate out. Return JSON {\"title\": a catchy title of at most 6 words, \"text\": the page, "
            "\"quote\": one short sweet or funny line someone actually wrote in the chat, copied exactly, or \"\", "
            "\"quoteBy\": who wrote it, or \"\"}.",
            "\n".join(facts)[-9000:], temperature=0.9)
        if not isinstance(entry, dict) or not entry.get("text"):
            raise ValueError("Saathi couldn't write the page, try again")
        page = self._get(f"d-{day}")
        page["entry"] = {k: str(entry.get(k, ""))[:1500] for k in ("title", "text", "quote", "quoteBy")}
        page["sig"] = self._sig(m)
        self.store.put(C, f"d-{day}", page)
        m["page"] = page
        return {"page": self._page(day, m, name)}

    def diary_line(self, name, mood, text):
        day = day_of()
        with self.lock:
            page = self._get(f"d-{day}")
            page.setdefault("lines", {})[name] = {"text": text[:300], "mood": mood if mood in MOODS else "",
                                                  "at": int(time.time())}
            page.pop("hidden", None)
            self.store.put(C, f"d-{day}", page)
        return {"ok": True}

    def diary_hide(self, day):
        with self.lock:
            page = self._get(f"d-{day}")
            page["hidden"] = True
            self.store.put(C, f"d-{day}", page)
        return {"ok": True}

    def study_log(self, name, mins, rounds, right, total, topic):
        day = day_of()
        with self.lock:
            page = self._get(f"d-{day}")
            st = page.setdefault("study", {}).setdefault(name, {"mins": 0, "rounds": 0, "right": 0, "total": 0})
            st["mins"] += max(0, min(600, int(mins)))
            st["rounds"] += max(0, min(20, int(rounds)))
            st["right"] += max(0, min(60, int(right)))
            st["total"] += max(0, min(60, int(total)))
            if topic:
                st["topic"] = topic[:80]
            self.store.put(C, f"d-{day}", page)
        return {"ok": True}

    # ---------- study-break quiz ----------

    def quiz(self, topic, image, avoid):
        result = self.ask(
            "You are a friendly study buddy making a quick revision quiz for a student's 5-minute study break. "
            "If a photo of notes or a book page is given, it is the source: ask only about what is on it. Otherwise "
            "use the topic. Make 3 multiple-choice questions that test understanding (not page numbers or trivia), "
            "medium difficulty, each with 4 short options and exactly one correct. Write questions in the language "
            "of the notes (English if the notes are English). Return JSON {\"questions\": [{\"q\": string, "
            "\"options\": [4 strings], \"answer\": index 0-3, \"why\": one short line explaining}], \"cheer\": one "
            "short funny Hinglish line to motivate them}.",
            f"Topic: {topic or 'see the photo'}\nDon't repeat these questions: " + " | ".join(avoid[-12:]),
            temperature=0.7, image=image)
        questions = []
        for item in (result.get("questions") or []) if isinstance(result, dict) else []:
            options = item.get("options") if isinstance(item, dict) else None
            try:
                answer = int(item.get("answer"))
            except (TypeError, ValueError):
                continue
            if item.get("q") and isinstance(options, list) and len(options) == 4 and 0 <= answer < 4:
                questions.append({"q": str(item["q"])[:300], "options": [str(o)[:160] for o in options],
                                  "answer": answer, "why": str(item.get("why", ""))[:300]})
        if not questions:
            raise ValueError("Couldn't make a quiz from that, try a clearer photo or topic")
        return {"questions": questions[:3], "cheer": str(result.get("cheer", ""))[:200]}

    # ---------- prompts ----------

    def _memory_text(self, names):
        about = self.about()
        lines = [f"The people: {' and '.join(names)}. They are a couple in a long-distance relationship, "
                 "talking on DU Meet, their private video-call app."]
        for label, field in (("Their story", "story"), ("What each of them likes", "likes"),
                             ("Inside jokes and pet names", "jokes"), ("Be careful about", "careful")):
            if about[field]:
                lines.append(f"{label}: {about[field]}")
        notes = self.notes()
        if notes:
            lines.append("What you remember from earlier conversations (oldest first):")
            lines += [f"- {n.get('text', '')}" for n in notes]
        open_promises = [p for p in self.promises() if not p.get("done")]
        if open_promises:
            lines.append("Promises they made that are still open:")
            lines += [f"- {p.get('who', '')}: {p.get('what', '')}" for p in open_promises[-8:]]
        past = [c for c in self.cases() if c.get("verdict")][-4:]
        if past:
            lines.append("Earlier Faislas (disagreements you judged):")
            for c in past:
                v = c["verdict"]
                lines.append(f"- {c.get('topic', '')}: {v.get('summary', '')}")
        return "\n".join(lines)

    def persona(self, names):
        """Who Saathi is, in every mode (voice and text)."""
        ai = self.about()["aiName"]
        who = " and ".join(names) if names else "the two of them"
        return f"""You are {ai}, the close friend of {who}: the one friend both of them trust, who is
on nobody's side but the relationship's. You are warm, quick, a little cheeky, emotionally sharp, and
genuinely funny, like the best friend in a good Hindi web series, never like a customer-care bot.

HOW YOU TALK
- Natural Hinglish, the way young Indians actually talk ("arre", "yaar", "sach mein?", "chalo",
  "scene kya hai", "bas kar", "acha suno"). If someone switches fully to Hindi or English, follow them.
- Short. Usually one to three sentences per turn, then let them talk. One question at a time.
- Use their names, react to what they just said, and remember details they told you earlier.
- Never say "as an AI", never read out lists or headings, no long disclaimers, no lectures, no sermons.
- Be specific. Generic advice ("communication is key") is banned; tie it to their real situation.

HUMOUR, WITH TIMING
- Read the mood first. Light moment: tease gently, make a desi joke, a filmy line, playful roasting of
  BOTH equally. Someone is hurt, crying, anxious or serious: no jokes at all; slow down, be soft, listen.
- Never joke about anything in "Be careful about", about their bodies, families, money worries or exams
  results, or about one of them to side with the other.
- A small joke after a tense moment is fine once things have calmed down, to make them smile.

READING THE CONTEXT
- Flirting or romantic moment: be happy for them, keep it wholesome, and offer to step back
  ("main thodi der chup, aap dono continue karo 😄" in words). Never get explicit.
- Someone is sad or stressed: empathy first, then ask what would help (listen, distract, or solve).
- They start arguing: don't pick a side fast. Calm things down, name what each is feeling, and suggest a
  proper Faisla if it's a real issue.
- They ask a fact, a recommendation or for help (food, movie, gift, plan, homework, code): answer directly
  and briefly, like a smart friend would.
- Plans, dates and promises: repeat them back clearly so they stick ("Done, Sunday 8 baje movie, pakka?").
- Only one of them is on the call: talk to that person, and don't share anything the other told you privately.

TRUTH AND FAIRNESS
- Never invent memories or facts about them; if you don't know, ask. Only use what is in your notes
  below or what they say now.
- Being invited by one of them gives that person no extra weight. Be honest even when it's awkward,
  but always kind.

SAFETY
If anyone mentions hurting themselves, being hurt, abuse, threats, or feeling unsafe: drop any game,
joke or judging, respond with real care, and gently encourage talking to someone they trust or calling
Tele-MANAS at 14416 (free, 24x7, India). Never help one partner control, track or deceive the other.

WHAT YOU KNOW ABOUT THEM
{self._memory_text(names)}
"""

    def system(self, mode, names, case=None):
        base = self.persona(names) + """
YOU ARE ON A LIVE VOICE CALL with them. You hear everyone through one audio stream, so tell voices apart
from context, and if you aren't sure who spoke, ask lightly ("ye kisne bola?"). Messages that start with
"(App:" come from the app, not from them: follow them quietly and never read them aloud.
When the app says one of them turned on the camera for you, you can see them; comment on what you see
only when it helps or they ask (outfits, food, something they show you), and be kind about looks.
"""
        if mode == "faisla" and case:
            sides = case.get("sides") or {}
            side_text = "\n".join(f"{who}'s side, written to you privately: {text}" for who, text in sides.items()) or \
                "Nobody wrote a side first; hear both live."
            return base + f"""
RIGHT NOW: you are the judge in a FAISLA about "{case.get('topic', '')}".
{side_text}

Run it like a fair, warm judge who is also their friend:
1. Open in two or three sentences: say neutrally what you understood from each side, and that you are
   here for both of them. A tiny light line is fine if the mood allows, never mocking.
2. The app announces turns ("It is now X's turn"). During X's turn, listen; at most one short
   follow-up question. Don't interrupt, don't argue back.
3. Ask one or two sharp questions to find the real issue (often a feeling or an unmet expectation,
   not the event itself). Treat both equally.
4. When the app says "Give your verdict now": for each main point say who was more right and roughly by
   how much ("late reply wale point pe 65-35, Uday ki taraf zyada galti") and why, kindly and honestly.
   Then the peace deal: one or two small, concrete things each person does, starting today. End with a
   warm line, and you may add one gentle joke to bring the smile back.
Never be a people-pleaser who splits everything 50-50 to avoid discomfort; never shame anyone.
"""
        if mode == "game":
            return base + """
RIGHT NOW: you are their GAME HOST, high energy, like a fun quiz-show host.
Offer: Truth or Dare (sweet, romantic, a bit spicy at most, never humiliating), "How well do you know
each other" built from your notes, Would You Rather, Never Have I Ever (clean), Antakshari-style word
chain, or 20 questions. Explain rules in one line, keep the pace fast, keep score out loud, tease the
loser lovingly, celebrate the winner, and offer a rematch.
"""
        if mode == "date":
            return base + """
RIGHT NOW: you help them PLAN A DATE. Ask what they feel like (date on the call tonight, or meeting in
person; budget; mood; how much time), one question at a time. Then pitch two or three specific, creative
ideas that fit what you know about them (not generic "go for dinner"), with a little detail that makes
each special. When they pick one, lock it: say the plan, the time, and who does what, clearly.
"""
        if mode == "story":
            return base + """
RIGHT NOW: tell a BEDTIME STORY starring the two of them. Soft, slow, cosy voice; little details from
your notes; a gentle plot (a trip, a rainy night, a tiny adventure); no cliffhangers. Three to five minutes,
ending with both of them falling asleep happily. Pause naturally. If they ask for changes, follow them.
"""
        return base + """
RIGHT NOW: you are just hanging out with them. Chat, joke, ask about their day, help with whatever they
ask, and keep both of them included.
"""

    # ---------- text tasks ----------

    def soften(self, text, name):
        return self.ask(
            "You help a person in a relationship say something kindly. Rewrite their message so it keeps the same "
            "meaning and honesty but sounds warm, calm and non-blaming. Use the same language mix they used "
            "(Hinglish stays Hinglish). Return JSON: {\"soft\": string, \"tip\": string (one short line on what changed)}.",
            f"{name} wants to send this to their partner:\n{text[:800]}")

    def verdict(self, case, transcript, names):
        sides = case.get("sides") or {}
        result = self.ask(
            "You are a fair, kind relationship judge. From both sides and the call transcript, write the final "
            "verdict as JSON: {\"title\": short title, \"summary\": two sentences, \"points\": [{\"point\": string, "
            f"\"share\": {{{', '.join(json.dumps(n) + ': percent of blame 0-100' for n in names)}}}, \"why\": string}}], "
            "\"deal\": {name: [one or two small concrete actions]}, \"warm\": one warm closing line, may include one gentle joke}. Shares in each "
            "point add up to 100. Write in simple Hinglish. Be honest, never shaming.",
            f"Topic: {case.get('topic', '')}\nPeople: {', '.join(names)}\n"
            + "\n".join(f"{who}'s private side: {text}" for who, text in sides.items())
            + f"\n\nCall transcript:\n{transcript[-12000:]}")
        if not isinstance(result, dict) or not result.get("points"):
            raise ValueError("No verdict came back")
        return result

    def remember(self, transcript, names, mode):
        """After a conversation: one short memory note and any promises made."""
        if len(transcript.strip()) < 40:
            return {"note": "", "promises": []}
        result = self.ask(
            "You keep a friendly memory for a couple's AI friend. From the transcript, return JSON: "
            "{\"note\": one or two sentences worth remembering next time (facts, plans, feelings; skip small talk; "
            "empty string if nothing), \"promises\": [{\"who\": name, \"what\": short promise, \"when\": "
            "\"when, in words, or empty\"}] for clear promises or plans only}.",
            f"People: {', '.join(names)}. Mode: {MODES.get(mode, mode)}.\nTranscript:\n{transcript[-12000:]}")
        note = str(result.get("note", ""))[:600] if isinstance(result, dict) else ""
        self.add_note(note)
        saved = []
        for item in (result.get("promises") or [])[:6] if isinstance(result, dict) else []:
            if not isinstance(item, dict) or not item.get("what"):
                continue
            promise = {"who": str(item.get("who", ""))[:40], "what": str(item["what"])[:200],
                       "when": str(item.get("when", ""))[:60], "at": int(time.time()), "done": False}
            pid = f"p-{int(time.time() * 1000)}-{len(saved)}"
            self.store.put(C, pid, promise)
            saved.append({"id": pid, **promise})
        return {"note": note, "promises": saved}


def handle(saathi, path, body, name_ok):
    """POST /api/ai/<action>. Returns a JSON-able dict, or raises ValueError (shown to the user)."""
    action = path.rsplit("/", 1)[1]
    name = str(body.get("name", ""))[:40]
    names = [str(n)[:40] for n in (body.get("names") or [])][:4] or ([name] if name else [])
    if action == "state":
        return saathi.state()
    if action == "about":
        return {"about": saathi.save_about(body.get("about") or {})}
    if action == "consent":
        if not name_ok(name):
            raise ValueError("Pick who you are first")
        return {"consent": saathi.set_consent(name, bool(body.get("ok")))}
    if action == "forget":
        saathi.forget()
        return {"ok": True}
    if action == "promise":
        pid = str(body.get("id", ""))
        doc = saathi._get(pid) if pid.startswith("p-") else {}
        if doc:
            doc["done"] = bool(body.get("done", True))
            saathi.store.put(C, pid, doc)
        return {"ok": True}
    if action == "case":       # open a new Faisla
        case = {"id": f"c-{int(time.time() * 1000)}", "topic": str(body.get("topic", "")).strip()[:140] or "Something happened",
                "by": name, "at": int(time.time()), "status": "open", "sides": {}}
        return {"case": Saathi._case_card(saathi.put_case(case))}
    if action == "side":       # one person's side, written privately
        case = saathi.case(body.get("id"))
        if not case or case.get("status") == "done":
            raise ValueError("This Faisla is closed")
        text = str(body.get("text", "")).strip()[:2500]
        case.setdefault("sides", {})[name] = text
        return {"case": Saathi._case_card(saathi.put_case(case))}
    if action == "drop":       # delete a Faisla (e.g. one opened just to try it)
        case = saathi.case(body.get("id"))
        if case:
            saathi.store.delete(C, case["id"])
        return {"ok": True}
    if action == "diary":
        return saathi.diary(name)
    if action == "diary-line":
        text = str(body.get("text", "")).strip()
        if not name_ok(name) or not (text or body.get("mood")):
            raise ValueError("Pick a mood or write a line")
        return saathi.diary_line(name, str(body.get("mood", "")), text)
    if action == "diary-hide":
        return saathi.diary_hide(str(body.get("day", ""))[:10])
    if action == "study-log":
        if not name_ok(name):
            raise ValueError("Pick who you are first")
        try:
            return saathi.study_log(name, body.get("mins", 0), body.get("rounds", 0), body.get("right", 0),
                                    body.get("total", 0), str(body.get("topic", "")).strip())
        except (TypeError, ValueError) as error:
            raise ValueError("Bad study numbers") from error
    if action == "follow":     # peace deal check-in
        case = saathi.case(body.get("id"))
        if case:
            case.setdefault("follow", {})[name] = "kept" if body.get("kept") else "not yet"
            saathi.put_case(case)
        return {"ok": True}

    # everything below talks to Gemini
    if not key():
        raise ValueError("Saathi is not switched on yet: add GEMINI_API_KEY on the server")
    if action == "token":
        if not TOKENS.ok():
            raise ValueError("Saathi needs a short break, try again in a while")
        mode = body.get("mode") if body.get("mode") in MODES else "talk"
        case = saathi.case(body.get("case")) if mode == "faisla" else None
        about = saathi.about()
        return {"token": saathi.token(), "model": LIVE_MODEL, "voice": about["voice"], "aiName": about["aiName"],
                "system": saathi.system(mode, names, case)}
    if not TEXTS.ok():
        raise ValueError("Saathi needs a short break, try again in a while")
    if action == "diary-write":
        return saathi.diary_write(str(body.get("day", ""))[:10], name)
    if action == "quiz":
        image = body.get("image") or None
        if image and (not isinstance(image, str) or len(image) > 3_000_000):
            raise ValueError("That photo is too big")
        topic = str(body.get("topic", "")).strip()[:200]
        if not topic and not image:
            raise ValueError("Add a topic or a notes photo for the quiz")
        if not saathi.consented([name]):
            raise ValueError("Agree to Saathi once first (open Saathi in a call)")
        avoid = [str(a)[:200] for a in (body.get("avoid") or [])][:20]
        return saathi.quiz(topic, image, avoid)
    if action == "soften":
        return saathi.soften(str(body.get("text", "")), name)
    if action == "verdict":
        case = saathi.case(body.get("id"))
        if not case:
            raise ValueError("Faisla not found")
        verdict = saathi.verdict(case, str(body.get("transcript", "")), names)
        case.update(verdict=verdict, status="done", followAt=int(time.time()) + 3 * 86400)
        saathi.put_case(case)
        return {"case": Saathi._case_card(case)}
    if action == "remember":
        return saathi.remember(str(body.get("transcript", "")), names, str(body.get("mode", "talk")))
    raise ValueError("Unknown request")
