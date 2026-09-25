# Super Mario Bros 3D (VR)

First-person remake of World 1-1 in Three.js + WebXR. You are Mario.

## Run

```
python -m http.server
ngrok http 8000
```

Open the ngrok https URL on your phone or VR headset, go to `/vrsupermariobros/` and press **Enter VR**.

On a phone, Enter VR goes fullscreen with a side-by-side stereo view (turn the phone sideways into the
headset) and uses the gyroscope for looking around. It does not use WebXR on purpose: browsers stop
sending motion-sensor data to the page during a WebXR session, which would break walking and hopping.
The optional **WebXR mode** button still exists on phones, but there only taps / holds move Mario.
On standalone headsets (Quest) Enter VR uses WebXR.

## Controls

Phone VR headset (body controls):
- Turn your head and body to look and steer
- Walk in place to walk, jog in place to run
- Hop (or tap the screen / headset button) to jump
- Hold the screen / headset button to walk forward if you have no room to move
- Stand on the warp pipe and look down into it to enter
- As Fire Mario, look at an enemy to throw fireballs

The title screen has a meter to test step / hop detection and a sensitivity setting.

VR controllers: left stick move, right stick snap turn, A/X jump, B/Y run + fire.

Desktop: WASD / arrows, mouse look (click to capture), SPACE jump, SHIFT run, F fire, C enter pipe, P pause, M mute.

## Code

- `src/main.js` game loop, states, camera rig, VR session, sequences (pipes, flagpole)
- `src/cardboard.js` phone headset mode: gyroscope head tracking and stereo rendering with lens correction
- `src/level.js` World 1-1 layout and level building
- `src/player.js` first-person Mario physics
- `src/entities.js` goombas, koopa, power-ups, fireballs, effects
- `src/motion.js` step / hop detection from the accelerometer (or headset pose)
- `src/input.js` merges body motion, touch, XR buttons, gamepads, keyboard and mouse
- `src/physics.js` box collisions, `src/models.js` / `src/textures.js` procedural art, `src/audio.js` synth sound + original music
