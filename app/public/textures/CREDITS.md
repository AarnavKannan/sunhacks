# Texture and sky credits

All files in this folder come from [Poly Haven](https://polyhaven.com) and are released
under **CC0** (public domain); no attribution is required, but credit is given anyway.
Textures are the 1K JPG maps (diffuse, OpenGL normal, roughness), recompressed.

| Folder / file | Poly Haven asset | Used for |
| --- | --- | --- |
| `asphalt_02/` | [asphalt_02](https://polyhaven.com/a/asphalt_02) | Roads, lots |
| `brushed_concrete/` | [brushed_concrete](https://polyhaven.com/a/brushed_concrete) | Median barrier, curbs, islands |
| `concrete_pavement/` | [concrete_pavement](https://polyhaven.com/a/concrete_pavement) | Sidewalk paving slabs |
| `gravel_ground_01/` | [gravel_ground_01](https://polyhaven.com/a/gravel_ground_01) | Gravel verges (motorway shoulder strip) |
| `leafy_grass/` | [leafy_grass](https://polyhaven.com/a/leafy_grass) | Terrain (green vegetation) |
| `withered_grass/` | [withered_grass](https://polyhaven.com/a/withered_grass) | Terrain (dormant vegetation) |
| `snow_02/` | [snow_02](https://polyhaven.com/a/snow_02) | Snow patches (winter) |
| `sandy_gravel/` | [sandy_gravel](https://polyhaven.com/a/sandy_gravel) | Terrain (arid) |
| `sky/kloofendal_48d_partly_cloudy_puresky.*` | [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Clear day sky |
| `sky/kloofendal_overcast_puresky.*` | [kloofendal_overcast_puresky](https://polyhaven.com/a/kloofendal_overcast_puresky) | Overcast winter sky |
| `sky/qwantani_dusk_2_puresky.*` | [qwantani_dusk_2_puresky](https://polyhaven.com/a/qwantani_dusk_2_puresky) | Dusk sky |
| `sky/kloppenheim_02_puresky.*` | [kloppenheim_02_puresky](https://polyhaven.com/a/kloppenheim_02_puresky) | Night sky |

Each sky has a 1K `.hdr` (scene lighting, reflections, sun direction) and a 4K tonemapped
`.jpg` (the visible backdrop).

Colour targets measured from reference footage (averaged over sampled frames):
overcast asphalt ≈ `#837e7a`, dormant verge grass ≈ `#727065`, snow ≈ `#b4bbc6`
(r05_s03); arid ground ≈ `#ab9a88` (drone clip 19166351).
