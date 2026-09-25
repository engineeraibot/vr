# Super Kart 64 VR

A Mario Kart 64 style race (one course inspired by Royal Raceway) in a phone VR headset,
steered with your hands: the phone's back camera sees them and MediaPipe tracks them.

## Run

```
python -m http.server
ngrok http 8000
```

Open the ngrok https URL on your phone, go to `/vrkart/`, press **Test hand steering** to check the
camera, then **Enter VR** and put the phone sideways into the headset. Sit down.

The headset must not cover the phone's back camera (take the front cover off, or use a headset with a
camera window). Hand tracking needs a reasonably lit room.

## Controls

- Both hands up in front of you = drive. Tilt them like a steering wheel: left hand higher turns right,
  right hand higher turns left (there is a swap option). One hand = slow, no hands = the kart stops.
- Look around by turning your head.
- Orange arrow pads = turbo. You need speed to clear the jump over the lake; fall in and Lakitu fishes you out.
- No camera: tilt your head to steer and hold the screen to drive.
- On a screen: webcam hands, arrow keys / WASD, or a gamepad. `C` switches first person / chase camera.

If the stereo view looks off in your headset, change **Headset lenses** on the title screen; add
`?dpi=140` (or 160) to the URL if the two images don't line up with the lenses.

## Code

- `src/main.js` race flow (countdown, laps, positions, results), controls, cameras
- `src/track.js` the circuit: spline centreline, road, ramps and jump, pads, scenery, track queries
- `src/karts.js` player kart physics and CPU drivers
- `src/hands.js` camera + MediaPipe HandLandmarker -> steering and throttle
- `src/cardboard.js` phone headset view (gyroscope head tracking, stereo with lens correction)
- `src/models.js`, `src/textures.js` procedural models and textures, `src/audio.js` engine, effects, music, `src/hud.js` HUD
