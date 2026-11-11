# DU Meet

Google Meet jaisa video calling app. Learning ke liye banaya gaya hai: video/audio call,
screen share, chat, raise hand, reactions, people list aur "who is speaking" highlight.

Koi install nahi chahiye. Sirf **Python 3** (Mac par pehle se hai) aur **Google Chrome**.

---

## 0. Sabse aasaan: ek shortcut

VS Code mein ye folder kholo aur **⌘ + Shift + B** dabao. Bas.

- Server start hota hai, Cloudflare ka public link banta hai, aur Chrome mein khul jaata hai.
- Terminal mein link dikhta hai: `DU Meet is live: https://….trycloudflare.com`
- Band karna ho: us terminal mein **Ctrl + C**.
- Sirf apne laptop par (bina link): **Terminal → Run Task… → DU Meet: Start (only this laptop)**.

VS Code ke bina terminal se: `./start.sh` (ya `./start.sh --local`).

---

## 1. VS Code mein kaise chalayein (manually)

1. VS Code kholo → **File → Open Folder…** → `Documents/VS Code/DU Meet` select karo.
2. Terminal kholo: **Terminal → New Terminal** (shortcut: `` Ctrl + ` ``).
3. Ye command chalao:

   ```bash
   python3 server.py
   ```

   Aisa dikhega:

   ```
   DU Meet is running at http://localhost:8000  (press Ctrl+C to stop)
   ```

4. Chrome mein kholo: **http://localhost:8000**
5. **New meeting** dabao → camera/mic ki permission **Allow** karo → naam likho → **Join now**.
6. Doosra participant banane ke liye: meeting ka link copy karo (address bar se, ya
   meeting ke andar ⓘ button se) aur **naye Chrome window** mein kholo. Dono windows
   ek doosre ko dekhenge aur sunenge.
7. Band karna ho to terminal mein **Ctrl + C**.

> **Tip:** Ek hi laptop par do windows mein awaaz ki goonj (echo) aayegi. Ek window
> mein mic band kar do (⌘ + D), ya headphones lagao.

> **Port busy hai?** `PORT=8080 python3 server.py` chalao aur http://localhost:8080 kholo.

---

## 1b. Kisi aur ke saath call (internet par)

Server chalu rakho, phir doosre terminal mein:

```bash
~/cloudflared tunnel --url http://localhost:8000
```

Output mein `https://kuch-words.trycloudflare.com` jaisa link aayega. Wahi link khud
kholo, meeting banao, aur ⓘ → *Copy joining info* se link bhejo. Har restart par link
badal jaata hai. Call ke baad dono terminals mein Ctrl + C.

---

## 1c. Alag networks par call (TURN relay) — zaruri

Page khul jaata hai, dono ek doosre ki tile dekhte ho, par **video/audio nahi aata**?
Iska matlab dono browsers ka seedha connection nahi ban paaya. Ye tab hota hai jab dono
alag networks par ho (jaise aapka WiFi + uska mobile data): Jio/Airtel jaise mobile
networks ek public IP bahut logon mein baant-te hain (CGNAT), aur STUN se raasta nahi
milta. Ek hi WiFi par ye problem nahi aati.

Fix: **TURN relay**, ek server jo video aage pass karta hai jab seedha raasta na mile.
Cloudflare ka TURN free hai (1000 GB/mahina):

1. https://dash.cloudflare.com par free account banao (ya login karo).
2. **Realtime → TURN Server → Create** karo, koi bhi naam do.
3. Jo **Turn Token ID** aur **API Token** milte hain, unhe copy karo.
4. Is folder mein `turn.env.example` ko copy karke `turn.env` naam do, aur dono values bharo:

   ```
   CLOUDFLARE_TURN_KEY_ID=yahan-token-id
   CLOUDFLARE_TURN_API_TOKEN=yahan-api-token
   ```

5. DU Meet restart karo. Terminal mein dikhega: `TURN relay: key found (Cloudflare)`. Agar call ke time `TURN credentials failed` aaye, to dono values dobara check karo.

`turn.env` secret hai: kisi ko mat bhejo, aur `public/` folder mein mat rakho. Browser
ko asli token kabhi nahi milta; server sirf 24 ghante wale temporary credentials deta hai.

**Abhi turant call karni hai, bina TURN?** Dono ek hi WiFi par aa jao, ya ek ka phone
hotspot doosra use kare.

---

### Bina card wala TURN: ExpressTURN

Cloudflare card maangta hai. ExpressTURN ka free plan (1 TB/mahina, Bengaluru server) card ke bina milta hai:

1. https://www.expressturn.com par free account banao.
2. Dashboard mein TURN server URL, username aur password milenge.
3. `turn.env` (ya Render ki Environment settings) mein daalo:

   ```
   TURN_URLS=turn:SERVER:3478,turns:SERVER:443
   TURN_USERNAME=yahan-username
   TURN_CREDENTIAL=yahan-password
   ```

Ye username/password browsers ko milta hai (TURN ka yahi tarika hai), isliye password lock zaroor on rakho.

---

## 1d. Laptop ke bina: Render par (hamesha chalu, pakka link)

`render.yaml` sab settings rakhta hai. Ek baar setup:

1. Ye folder GitHub par **private** repo mein push karo.
2. https://dashboard.render.com → **New → Blueprint** → wo repo choose karo.
3. Render teen values maangega:
   - `DU_MEET_PASSWORD`: app ka password (sirf aap dono ko pata ho)
   - `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`: section 1c wali TURN key
4. **Apply** dabao. 1–2 minute mein link milega: `https://du-meet-xxxx.onrender.com`.

Har device par password ek baar poochha jaata hai, phir 1 saal yaad rehta hai.
Password badloge to sab devices se logout ho jaoge. Free plan par 15 minute koi use na kare
to server so jaata hai; agli baar kholne mein ~30–50 second lagte hain. Code mein badlaav
GitHub par push karte hi Render apne aap naya version chala deta hai.

Laptop par password lock chahiye to `turn.env` mein `DU_MEET_PASSWORD=...` likh do.

---

## 2. Features

| Feature | Kahan hai |
|---|---|
| New meeting / code ya link se join | Home page |
| Join se pehle camera preview, mic/cam on-off, naam, settings ⚙ | Lobby |
| "Aman is in this call" (kaun pehle se hai) | Lobby |
| Video + audio call (kai log, grid layout) | Room |
| Mic / camera on-off (⌘ + D, ⌘ + E jaise Meet mein) | Neeche buttons |
| **Pin** kisi bhi person / screen / whiteboard (sirf aapke liye) | Tile par 📌 (ya double-click), People list |
| **Camera switch** front ↔ back (phone), next camera (laptop) | 🔄 button (jab 2+ camera hon) |
| **Picture-in-picture**: bolne wala / pinned / presentation dikhta hai, khud nahi | ⋮ → Open picture-in-picture |
| Screen share: camera aur presentation **alag tiles** | 🖥 button |
| Layouts: Auto, Tiled, Spotlight, Sidebar | ⋮ → Change layout |
| Live captions (Chrome), Hindi + 8 Indian languages | CC button, language Settings mein |
| Recording (meeting + sabki awaaz, .webm download) | ⋮ → Record meeting |
| Mic / speaker / camera choose, noise cancellation | ⋮ → Settings |
| Hide self view, Full screen | ⋮ menu |
| Raise hand ✋ (jis order mein uthaya, usi order mein list mein) | ✋ button, Ctrl + Alt + H |
| Emoji reactions jo screen par udte hain | 🙂 button |
| In-call chat (links clickable) + unread dot | 💬 button, Ctrl + Alt + C |
| People list: pin, kisi ko mute karna | 👥 button, Ctrl + Alt + P |
| Bolne wale ki tile par blue border, auto spotlight | Automatic |
| **Naya:** Shared whiteboard (sab saath draw karein, PNG save) | ⋮ → Open whiteboard |
| **Naya:** Polls (live results) | 🗳 button |
| **Naya:** Meeting notes download (chat + captions + polls) | ⓘ panel ya ⋮ menu |

Der se join karne wale ko whiteboard aur polls apne aap mil jaate hain.

---|---|
| New meeting / code ya link se join | Home page |
| Join se pehle camera preview, mic/cam on-off, naam | Lobby |
| "Aman is in this call" (kaun pehle se hai) | Lobby |
| Video + audio call (kai log, grid layout) | Room |
| Mic / camera on-off (⌘ + D, ⌘ + E jaise Meet mein) | Neeche buttons |
| Screen share (present now) | 🖥 button |
| Raise hand ✋ (tile par aur people list mein upar) | ✋ button |
| Emoji reactions jo screen par udte hain | 🙂 button |
| In-call chat + unread dot + notification | 💬 button |
| People list (mic status, raised hand) | 👥 button |
| Meeting link copy | ⓘ button |
| Bolne wale ki tile par blue border | Automatic |
| Join/leave notifications | Automatic |

---

## 3. Files

```
DU Meet/
├── start.sh           Ek command: server + Cloudflare link + browser kholna
├── .vscode/tasks.json ⌘ + Shift + B shortcut
├── server.py          Python server: pages serve karta hai + browsers ko milwata hai (signaling)
├── turn.env.example   TURN relay key ka template (section 1c); asli key turn.env mein
└── public/
    ├── index.html     4 screens: Home, Lobby, Room, "You left"
    ├── style.css      Saari designing (Meet jaisa dark room, light home page)
    └── app.js         Asli logic: camera, WebRTC connections, chat, reactions…
```

---

## 4. Ye kaam kaise karta hai (samjho)

### Video call ke do hisse hote hain

1. **Signaling (milwana):** Do browsers ek doosre ka address nahi jaante. Pehle unhe
   ek beech wale server se chhote messages bhejne padte hain: "main yahan hoon, mere
   paas ye video formats hain, mujhe is IP/port par pakdo". Ye `server.py` karta hai.
2. **Media (asli video/audio):** Ek baar connection ban gaya, to video aur audio
   **seedha browser se browser** jaata hai (**WebRTC**). Server par video nahi aata.

### Ek call ka flow

```
Riya (naya)                 server.py                  Aman (pehle se)
    |-- poll (join) --------->|                             |
    |<-- welcome: [Aman] -----|-- join: Riya -------------->|
    |-- offer (SDP) --------->|-- offer ------------------->|
    |<-------------------------|<-- answer (SDP) ------------|
    |<== ice candidates ======>|<== ice candidates =========>|
    |<================ seedha video + audio (WebRTC) =======>|
```

- **SDP offer/answer:** "Main audio (Opus) aur video (VP8/H.264) bhej sakta hoon"
  jaisi details. `callPeer()` aur `answerPeer()` in `app.js`.
- **ICE candidates:** Network address (IP + port) jahan se connect ho sakte hain.
  **STUN** server (`stun.l.google.com`) batata hai ki internet ko aapka public IP kya dikhta hai.
- **Server → browser:** Long polling (`/api/poll`). Browser poochta hai "mere liye
  koi message?", aur server 20 second tak rukta hai jab tak koi message na aaye.
  Jawab milte hi browser phir poochta hai. (Streaming connection, yaani Server-Sent
  Events, Cloudflare tunnel se pass nahi hota tha, isliye ye tarika use kiya.)
- **Browser → server:** simple `POST /api/send`.

### `app.js` mein kya kahan hai

| Function | Kaam |
|---|---|
| `startMedia()` | Camera + mic ki permission lekar stream lena |
| `joinMeeting()` / `pollLoop()` | Apni tile banana, server se messages lagatar maangna |
| `handleMessage()` | Server se aaye har message (welcome, join, offer, chat…) ko handle karna |
| `addPeer()` | Har naye insaan ke liye ek `RTCPeerConnection` + tile |
| `callPeer()` / `answerPeer()` | Offer/answer ka lena-dena |
| `setOutgoingVideo()` | Camera ↔ screen share switch, `replaceTrack` se (bina call tode) |
| `watchAudio()` | Web Audio API se awaaz ki loudness naapna (speaking highlight) |
| `togglePanel()` | Info / People / Chat side panel |

---

## 5. Google Meet asal mein kaise kaam karta hai (learning)

Google Meet ka code copy karna ya use reverse engineer karna Google ki Terms ke
khilaaf hai, aur iski zarurat bhi nahi. Meet bhi wahi open standard (**WebRTC**)
use karta hai jo DU Meet karta hai. Farq architecture mein hai:

| | DU Meet | Google Meet |
|---|---|---|
| Media kaise jaata hai | **Mesh:** har koi har kisi ko seedha bhejta hai | **SFU (Selective Forwarding Unit):** sab Google ke server ko ek stream bhejte hain, server sabko aage bhejta hai |
| Kitne log | ~4–6 (har naya insaan har kisi ka upload badhata hai) | 100+ |
| Quality adjust | Browser khud | **Simulcast:** aap 3 quality (high/medium/low) bhejte ho, server har viewer ko uske network ke hisaab se ek deta hai |
| Firewall ke peeche | Kabhi kabhi fail (sirf STUN) | **TURN** servers media relay karte hain, hamesha connect |
| Codecs | Browser default (VP8/Opus) | VP8/VP9/AV1 + Opus |
| Extra | — | Recording, live captions (speech-to-text), noise cancellation, background blur (ML models) |

### Khud dekho (legal aur bahut useful)

Chrome mein ek built-in tool hai jo **aapke apne browser** ki saari WebRTC calls ki
details dikhata hai:

1. DU Meet ki call chalu rakho (ya koi bhi video call).
2. Naye tab mein kholo: `chrome://webrtc-internals`
3. Wahan dikhega: SDP offer/answer, ICE candidates, kaunsa codec chal raha hai,
   bitrate, packet loss, frame rate graphs.

Isse samajh aata hai ki asli video apps andar se kaise behave karte hain, bina kisi
ka code chheday.

---

## 6. Limitations (jaan bujhkar simple rakha hai)

- **HTTPS zaruri:** Camera/mic sirf `https://` ya `localhost` par chalte hain. Isliye
  doosre log Cloudflare tunnel wale https link se hi join karte hain (section 1b).
- **Mesh:** 5–6 se zyada log ho to laptop slow ho jayega. Bade calls ke liye SFU
  (jaise open-source **LiveKit** ya **mediasoup**) lagana padega.
- **TURN relay apne aap nahi:** Alag-alag networks (jaise college WiFi + mobile data)
  ke beech call ke liye section 1c wala free Cloudflare TURN key lagana padta hai.
- Icons aur font Google Fonts se load hote hain, isliye internet chahiye.

## 7. Aage kya seekh/bana sakte ho

1. Background blur (MediaPipe selfie segmentation)
2. Breakout rooms
3. SFU par shift karna (LiveKit), taaki 20+ log aa sakein
