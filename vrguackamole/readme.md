# Whack-a-Mole VR (passthrough)

The eye-toy Whack-a-Mole in a phone VR headset: the phone's back camera shows you your own room, nine
little floating grass islands hang in front of you at arm's length, and moles pop out of them. Swat
them with your real hands before they duck back down, and don't whack the bombs.

Same rules as `eye-toy/whack-a-mole.html`: mole = +1, bomb = -1 life, 3 lives, a level every 10 moles
(moles come faster and stay out less), a life back every 5 levels, bombs get more common, top 10
leaderboard.

## Run

```
python serve.py        (from the vr folder; like http.server but without caching)
ngrok http 8000
```

Open the ngrok https URL on your phone, go to `/vrguackamole/`, optionally press **Test the camera**,
then **Enter VR** and put the phone sideways into the headset.

The headset must not cover the phone's back camera (take the front cover off, or use a headset with a
camera window). Hand tracking needs a reasonably lit room.

## Controls

- Swat the mole holding the **START** sign in the middle hole to begin (and the **AGAIN** one after a
  game over). Holding the screen for a second also starts.
- Turn your head to see all nine holes; look at the mole you're going for, so the camera sees your hand.
  A yellow ring shows each hand the tracker sees: that's what whacks.
- Double tap (headset button twice) = recenter the holes in front of you.
- With **Real hands in front of the moles** on, your hands are drawn over the moles (from the tracked hand
  shape), so a hand in front of a mole covers it.
- No camera: look at a mole (white reticle) and tap to whack it.
- On a screen: webcam hands, click / tap the moles, or keys Q W E / A S D / Z X C (one per hole).
  M = mute, R = recenter, Esc = menu.

## Tuning the passthrough

One camera means both eyes see the same picture, placed at arm's length where your hands and the holes
are. The picture is only as wide as the camera's view (about 66°), so the edges of your view are black.

- **Camera field of view**: if the room seems to swing when you turn your head, change it on the title
  screen: smaller if the room moves against your head turns, bigger if it follows them. Hitting moles
  works either way (the hands are placed with the same numbers as the picture).
- **Camera lag**: the picture and the hands are placed where your head pointed when the frame was taken,
  80 ms ago by default. If the room still wobbles when you turn quickly, try `?lag=60` .. `?lag=150`.
- If the stereo view looks off in your headset, change **Headset lenses**; add `?dpi=140` (or 160) to the
  URL if the two images don't line up with the lenses.
- If hands are rarely detected in VR, try **Hand tracker: CPU**.
- **Background: Cartoon garden** swaps your room for the original game's sunny garden.

## Code

- `src/main.js` game flow (ready, play, game over), whacking (hand / tap / click / keys), layout, camera
- `src/moles.js` floating islands with real holes, moles, bombs, the START sign, pop-up timing
- `src/passthrough.js` camera picture in the headset, head orientation history, the hands-in-front mask
- `src/hands.js` + `src/hands-worker.js` camera + MediaPipe HandLandmarker (in a worker)
- `src/cardboard.js` phone headset view (gyroscope head tracking, stereo with lens correction)
- `src/effects.js` chips, stars, "+1", bomb blasts; `src/garden.js` cartoon background
- `src/hud.js` HUD (scoreboard above the field in VR), `src/audio.js` sounds and music, `src/scores.js` leaderboard
