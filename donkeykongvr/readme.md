# Donkey Kong 3D VR

First-person 3D remake of the classic Donkey Kong 25m girder stage in Three.js + WebXR / Cardboard VR. You are Mario saving Pauline from Donkey Kong!

## Run

```bash
python serve.py
# or: python -m http.server
```

Open `http://localhost:8000/donkeykongvr/` in your browser or phone headset URL.

## Features & Controls

- **Jumping Barrels:** Physically hop in place (detected via phone accelerometer/gyro) or press SPACE / tap screen to jump over rolling barrels.
- **Ladder & Vine Climbing:** Stand near a ladder or vine, look UP at the ladder top, and jog/step in place to climb upward rapidly! The faster you jog, the faster you ascend.
- **Barrel Cannons:** Floating cannons with target reticles hang over gaps. Look directly into a cannon barrel (gaze lock crosshair expands and turns gold) and hop or tap to blast Mario across the canyon!
- **Ducking:** Squat down physically or look down at your feet (or press C / crouch key) to duck under high-flying barrels or swinging construction girders!
- **Hammers & Items:** Pick up giant hammers to crush barrels, collect Pauline's lost parasol and purse for bonus points!
