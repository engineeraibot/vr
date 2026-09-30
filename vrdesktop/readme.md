# VR Desktop

Your PC's screen on a giant curved virtual monitor, for a phone in a Cardboard headset. The PC shares
its screen from a browser tab and the phone receives it over WebRTC. Nothing to install: Chrome / Edge
on the PC, Python for the server.

## Run

Everything runs from this folder:

```
cd vrdesktop
python server.py
python control.py        (optional, second terminal: mouse control from the headset)
```

1. On the PC open **http://localhost:8000/host.html**, press **Share screen** and pick
   **Entire screen** (tick "Also share system audio" for sound). It shows a 6-letter code and the
   address for the phone.
2. On the phone (same Wi-Fi) open that address, e.g. `https://192.168.1.23:8443`. The first time it
   warns that the connection isn't private: tap **Advanced**, then **Proceed**. Type the code, press
   **Enter VR** and put the phone sideways into the headset. Look where you want the screen: double
   tap to put it there.

Nothing goes through the internet: the page, the handshake and the video all stay on your Wi-Fi.
The phone needs https to read the gyroscope, so server.py makes its own certificate (with the openssl
that comes with Git for Windows) in `cert/` the first time, and again if the PC's address changes.
That certificate isn't signed by anyone the phone knows, hence the warning.

If the phone can't load the page: Windows Firewall blocks it on networks marked *Public*. Either mark
your home Wi-Fi as *Private* (Settings > Network & internet > Wi-Fi > your network > Private network)
and click Allow when Windows asks about Python, or allow Python in the firewall.

ngrok still works instead of the Wi-Fi address (`ngrok http 8000`, then open its https URL).

## In the headset

- Look down for the buttons: Recenter, Smaller / Bigger, Closer / Further, Curved / Flat, Mouse, Sound.
  Look at one and tap.
- Double tap = recenter.
- The simplest way to work: use the PC's own mouse and keyboard; the pointer shows on the virtual screen.
- Mouse ON (optional, see below): look + tap = click, tap twice = double click, hold still = right click,
  hold and tilt your head up / down = scroll. Double tap away from the screen to recenter.

A phone headset has far fewer pixels than a monitor, so small text needs the screen big and close:
**Bigger** until the text is readable and turn your head to read. On the PC, **Max resolution 1080p**
(the default) is usually the best balance; Windows display scaling of 125-150% helps too.

## Mouse control (optional, Windows)

```
python control.py
```

Then tick **Let the headset click and scroll** on host.html and turn Mouse ON in the headset. It works
when sharing an entire screen; with several monitors check that host.html picked the right one.
control.py only listens on 127.0.0.1 and only accepts requests from pages served by localhost, so it
can't be reached through ngrok; the headset's clicks go phone -> host.html (WebRTC) -> control.py.

## Quality settings (host.html)

- **Content**: *Desktop, text* keeps the resolution and drops frames when the network is busy;
  *Video, games* does the opposite.
- **Bitrate**: 10 Mbps is fine on most Wi-Fi; raise it for sharper text in moving content.
- **Codec**: try H.264 if the phone stutters (hardware decoding). Stats (resolution, fps, bitrate,
  round trip) show on host.html and on the status line above the headset buttons.

## Code

- `host.html`, `src/host.js` the PC side: screen capture, WebRTC sender, quality, forwards input to
  control.py
- `index.html`, `src/main.js` the phone side: scene, gaze + tap input, VR / flat view
- `server.py` serves this folder (http on localhost for the PC, https on the Wi-Fi for the phone,
  no caching) plus the `/signal/` mailbox for the handshake
- `src/receiver.js` receives the stream, reconnects by itself; `src/link.js` the handshake (shared by both sides)
- `src/screen.js` the curved / flat virtual monitor, `src/toolbar.js` the gaze buttons
- `src/cardboard.js` phone headset view (gyroscope head tracking, stereo with lens correction), copied
  from the other projects (renders at up to 3x pixel ratio here, for text)
- `control.py` moves / clicks / scrolls the real mouse (Windows, ctypes)

Anyone on your Wi-Fi who knows the code could watch the shared screen (with ngrok: anyone with the
URL and the code). Press **New code** on host.html to lock out anyone who knew the old one.
