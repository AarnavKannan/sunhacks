"""Pydantic models for the scene package. Field names match schema/."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0.0"

VehicleType = Literal["car", "van", "truck"]
LabelSource = Literal["vlm", "manual", "measured"]
CarriagewayId = Literal["a", "b"]
EventType = Literal["impact", "brake", "rest", "lane_change", "pass"]
SplatFormat = Literal["ply", "spz"]
HexColor = str


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Units(StrictModel):
    length: Literal["m"]
    time: Literal["s"]


class Origin(StrictModel):
    landmark: str
    description: str


class SourceVideo(StrictModel):
    filename: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    codec: str
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    fps: float = Field(gt=0)
    duration_s: float = Field(gt=0)
    frame_count: int = Field(ge=1)
    has_audio: bool


class MosaicLayout(StrictModel):
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    image_origin: Literal["top-left"]
    column_gutter_x: tuple[int, int]
    row_gutter_y: tuple[int, int]
    letterbox_y: tuple[int, int]


class RoadCarriageway(StrictModel):
    heading: Literal["+X", "-X"]
    z_sign: Literal[-1, 1]
    cameras: list[str]


class Carriageways(StrictModel):
    a: RoadCarriageway
    b: RoadCarriageway


class Road(StrictModel):
    stretch_m: float = Field(gt=0)
    x_min_m: float
    x_max_m: float
    lane_width_m: float = Field(gt=0)
    lanes_per_carriageway: int = Field(ge=1)
    shoulder: bool
    median_half_width_m: float = Field(gt=0)
    carriageways: Carriageways


class ModelRecord(StrictModel):
    role: str
    name: str
    version: str
    seed: int


class Seeds(StrictModel):
    schematic: int
    kinematics: int


class ClassColor(StrictModel):
    name: str
    hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class ClassLegend(StrictModel):
    car: ClassColor
    van: ClassColor
    truck: ClassColor


class PipelineInfo(StrictModel):
    name: str
    version: str
    command: str
    config: str


class Manifest(StrictModel):
    id: str
    schema_version: Literal["1.0.0"]
    description: str
    fps: float = Field(gt=0)
    duration_s: float = Field(gt=0)
    frame_count: int = Field(ge=1)
    impact_time_s: float | None
    units: Units
    up_axis: Literal["Y"]
    crs: Literal["local"]
    origin: Origin
    source: SourceVideo
    mosaic: MosaicLayout
    road: Road
    tracks_are_schematic: bool
    splat_format: SplatFormat
    models: list[ModelRecord] = Field(min_length=1)
    seeds: Seeds
    class_legend: ClassLegend
    pipeline: PipelineInfo


class Sigma(StrictModel):
    pos_m: float = Field(ge=0)
    speed_mps: float = Field(ge=0)


class Sample(StrictModel):
    t: float = Field(ge=0)
    pos: tuple[float, float, float]
    quat: tuple[float, float, float, float]
    vel: tuple[float, float, float]
    acc: tuple[float, float, float]
    speed_mps: float = Field(ge=0)
    heading_deg: float = Field(ge=-180, le=180)
    yaw_rate: float
    sigma: Sigma


class Visibility(StrictModel):
    t_start: float = Field(ge=0)
    t_end: float = Field(ge=0)


class Track(StrictModel):
    entity_id: str
    carriageway: CarriagewayId
    visibility: Visibility
    samples: list[Sample] = Field(min_length=2)


class TracksFile(StrictModel):
    tracks: list[Track]


class Dims(StrictModel):
    length: float = Field(gt=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class Entity(StrictModel):
    id: str
    label: str
    color: str
    color_hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    type: VehicleType
    make: str | None
    model: str | None
    dims_m: Dims
    aliases: list[str]
    confidence: float = Field(ge=0, le=1)
    label_source: LabelSource
    carriageway: CarriagewayId
    splat: str


class EntitiesFile(StrictModel):
    entities: list[Entity]


class Event(StrictModel):
    id: str
    t: float = Field(ge=0)
    type: EventType
    vehicles: list[str] = Field(min_length=1)
    note: str


class EventsFile(StrictModel):
    events: list[Event]


class Crop(StrictModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class Intrinsics(StrictModel):
    model: Literal["pinhole"]
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fx: float = Field(gt=0)
    fy: float = Field(gt=0)
    cx: float
    cy: float


class Extrinsics(StrictModel):
    convention: Literal["camera_to_world_opengl"]
    position_m: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]


class Camera(StrictModel):
    id: str
    static: bool
    mosaic_crop: Crop
    intrinsics: Intrinsics
    extrinsics: Extrinsics
    note: str


class CamerasFile(StrictModel):
    cameras: list[Camera] = Field(min_length=1)


class ScenePackage(StrictModel):
    manifest: Manifest
    tracks: TracksFile
    entities: EntitiesFile
    events: EventsFile
    cameras: CamerasFile
