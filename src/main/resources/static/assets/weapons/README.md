# Weapon assets

Only assets with a verified redistribution license may be enabled in `manifest.json`.

The manifest uses Weapon Asset Contract v2. Combat definitions stay in
`src/main/resources/weapons.yml`; this manifest contains presentation only. Each
entry may declare an independent `viewModel`, `worldModel`, `audio`, and license.

Expected optional node names:

- `Muzzle`: muzzle flash and smoke origin
- `Magazine`: reload animation attachment
- `Bolt`: cycling animation attachment

Expected optional clip names:

- `Idle`
- `Fire`
- `Reload`
- `Equip`
- `Cycle`

The client keeps the procedural view model visible until a GLB loads successfully. A missing or invalid asset must never prevent joining a match.

## Current M4A1 prototype

`m4a1-stylized.glb` is converted from `AssaultRifle2_2.fbx` in the Quaternius Ultimate Gun Pack. Its flat-top receiver and modular rail make it the active stylized appearance for the M4A1 gameplay slot.

`m4a1-viewmodel.glb` combines that rifle with original low-poly tactical sleeves and gloves created for this project.

- Author: Quaternius
- Source: https://quaternius.com/packs/ultimategun.html
- License: CC0 1.0
- Local license copy: `QUATERNIUS-CC0.txt`

`m16-stylized.glb` is converted from `AssaultRifle2_1.fbx`. It is retained as a future M16-family asset and is not currently enabled in the weapon catalog.

`kenney-blaster-f.glb` and its `Textures/colormap.png` remain as an unused CC0 sci-fi rifle asset from Kenney Blaster Kit 2.1.

## Current AK47 prototype

`ak47-viewmodel.glb` is J-Toastie's original animated FPS Rig AKM. It includes skinned
arms plus authored Idle, Shoot and Reload actions. To avoid damaging skin weights in a
Blender round-trip, Three.js creates Muzzle/EjectionPort markers and recolors sleeves
at runtime. `prepare_ak_viewmodel.py` is retained only as a study/inspection pipeline.

- Author: J-Toastie
- Source: https://poly.pizza/m/U6l6wjxFhC
- License: CC BY 3.0
- Local attribution: `J-TOASTIE-CC-BY-3.0.txt`

## Current Glock prototype

`glock-viewmodel.glb` keeps J-Toastie's original animated FPS rig unchanged. It
provides Grip, Idle, Shoot and Reload clips plus independent Slide, Magazine,
Trigger and Barrel bones.

`glock-worldmodel.glb` is generated from the no-arms Rigged Glock source by
`scripts/blender/flatten_world_model.py`. The skeleton is baked into static meshes
so remote players can safely clone it without Three.js SkeletonUtils.

- Author: J-Toastie
- Source: https://poly.pizza/bundle/FPS-pack-QKgLgzmIZ2
- License: CC BY 3.0
