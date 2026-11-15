# Viewer UI/UX features

What the viewer should let people do, and what the assistant (chat or voice) must be able to do through the MCP tools.

## Camera
- Pan (hand tool), rotate and zoom.
- The camera can move while the video is playing.
- Standard views like SolidWorks: front, back, left, right, top, bottom, isometric, dimetric, trimetric. Everything except "Normal To" (the plane view).
- Scrolling scrolls the dashboard and chat panels, not the camera.

## Playback
The camera can move freely while the reconstruction plays: pan, rotate and zoom without pausing. Playback speed is adjustable, so you can slow down to study the moments around the crash or speed up through the quiet stretches. You can also view the original source video alongside the 3D scene, kept in sync with it.

## Vehicle POV
Select a vehicle and view the scene from its point of view (riding along as it plays). Stretch goal; feasibility to be confirmed.

## Home screen
- On launch, a Google Drive–style tile layout of uploaded reconstructions, with folders on the left.
- For the demo, our main reconstruction is already uploaded.
- Opening one switches to a full-page viewer; Back returns to the folders.

## Advanced transformations (Settings)
- Exact numeric controls for every major transformation: rotate by N degrees, move by N meters, set an exact camera position.
- The assistant uses the same math to drive the camera through MCP.

## Scene bounds
- A visible white or black box around the splat marks the scene boundary.
- The camera can't leave the box. Moving past the edge just stops, like hitting the edge in Google Maps.
- Vehicles can drive in and out of the frame inside it.

## Per-frame physics data
- For every frame and every object (about 20 at most): position, velocity, speed, acceleration, direction and forces.
- Stored in a database and queryable.
- Still to figure out: modeling air drag and friction.

## Natural-language queries (voice or text)
- "What was the red Toyota's speed at 3.2 s?"
- "…3 seconds before the crash?"

## Crash period
- The crash is a period with a start and an end, not a single moment.
- "Before the crash" means before the start; "after the crash" means after the end.
