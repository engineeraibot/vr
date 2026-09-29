# Crazy Coaster VR

A roller coaster for a phone in a Cardboard headset: a 97° drop, a loop, corkscrews, swinging axes,
a monster that swallows you and launches you out of its belly to 177 km/h, a top hat into space, a
broken track you jump over a lava canyon, barrel rolls, a splashdown and a helix. About 2.5 minutes.

## Run

```
python serve.py        (from the vr folder; like http.server but without caching)
ngrok http 8000
```

Open the ngrok https URL on your phone, go to `/vrrollercoaster/`, press **Enter VR** and put the phone
sideways into the headset. Sit down (on a chair that doesn't spin). The ride starts by itself after a
few seconds; look straight ahead when it does, that becomes "forward".

If the stereo view looks off in your headset, change **Headset lenses** on the title screen; add
`?dpi=140` (or 160) to the URL if the two images don't line up with the lenses. On slow phones the
stereo view switches itself to a lighter mode (no anti-aliasing, lower resolution).

## Controls

- Look around by turning your head. Double tap = recenter.
- Look at a balloon to pop it (the reticle turns yellow when you're on target). Gold stars are worth 5
  and hide in tricky places: up, sideways, behind you.
- Tap / hold the screen (headset button) = hands up and scream.
- A dashboard screen in the car shows speed, height, g-force and balloons: look down.
- At the end: tap to ride again.
- On a screen: drag or arrow keys to look, space = hands up, C = chase camera, M = mute, R = recenter.

Not for anyone who gets motion sick easily. **Camera rumble** on the title screen can be turned off.

## Code

- `src/track.js` the layout, built like a turtle drawing: each segment turns the rider's frame by
  pitch / yaw (around world up) / roll per metre with eased rates, so loops, corkscrews and
  beyond-vertical drops come out exact. Also the rails, ties, supports and tunnel meshes.
- `src/main.js` ride physics (gravity, drag, chain lift, launch with countdown, booster, brakes),
  g-forces and airtime, events along the track, gaze popping, cameras
- `src/world.js` park, sky that turns into space up high, monster, axes, lava canyon and rings of fire,
  UFO, balloons, particles and fireworks
- `src/train.js` the cars and the riders, `src/audio.js` wind, clacks, screams and music (all Web Audio),
  `src/hud.js` HUD
- `src/cardboard.js` phone headset view (gyroscope head tracking, stereo with lens correction), shared
  with the other projects

To change the layout, edit `LAYOUT` in `track.js`; `PH_DROP` and `PH_UP` are the straights that set
the heights of the first drop and the top hat.
