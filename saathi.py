"""DU Meet · Saathi, the AI friend who joins your call (Google Gemini).

Two ways of talking to Gemini, both with the key kept here on the server:

* Voice (Gemini Live API): the browser asks for a short-lived, single-use token and
  talks to Gemini directly over a WebSocket, so audio never passes through this server.
  The system instruction (who you are, what Saathi remembers, both sides of a Faisla)
  is built here and handed over with the token.
* Text (generateContent): verdict cards, softening a message, and the short note
  Saathi keeps after every conversation.

Saathi's memory lives in the server-only collection "ai" (the browser can't read it
through /api/data): "about" (what you told it), "consent", notes "n-…", Faisla cases
"c-…" and promises "p-…". Everything can be wiped with one call (forget()).
"""

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

    def ask(self, system, prompt, as_json=True, temperature=0.6):
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
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

    def chat(self, name, names, history, text):
        """'Ask Saathi privately': a text chat only `name` sees. Not stored."""
        system = self.persona(names) + f"""
RIGHT NOW: {name} is texting you PRIVATELY. The other person cannot see this chat, and you don't tell
them about it. Help {name} like a wise best friend: understand first, then give honest, practical
help (what to say, how to say it, what to do next). If {name} is wrong, say so kindly. Encourage honesty
with the partner; never help with lying, spying, guilt-tripping or manipulation.
Reply like a text message: short paragraphs, Hinglish, at most a few lines, a little humour when it fits.
Plain text only, no markdown, no headings."""
        turns = []
        for item in history[-16:]:
            role = "model" if item.get("role") == "ai" else "user"
            if str(item.get("text", "")).strip():
                turns.append({"role": role, "parts": [{"text": str(item["text"])[:1500]}]})
        turns.append({"role": "user", "parts": [{"text": text[:1500]}]})
        body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": turns,
                "generationConfig": {"temperature": 0.85}}
        data = self._post(f"{API}/models/{TEXT_MODEL}:generateContent", body)
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        reply = "".join(p.get("text", "") for p in parts).strip()
        if not reply:
            raise ValueError("Saathi had nothing to say, try again")
        return reply

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
    if action == "chat":
        text = str(body.get("text", "")).strip()
        if not text or not name:
            raise ValueError("Write something first")
        history = [h for h in (body.get("history") or []) if isinstance(h, dict)]
        return {"reply": saathi.chat(name, names, history, text)}
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
