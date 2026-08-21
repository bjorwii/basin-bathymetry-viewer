from pathlib import Path
import uuid

import rasterio
from rasterio.windows import from_bounds, Window

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel


# ============================================================
# PATH CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent


# ============================================================
# ORIGINAL DATA
# ============================================================
#
# Original TIFF berada DI LUAR repository.
#
# C:\GEO-AI\BASIN_DATASETS\
# ├── esrgan.tif
# └── gebco.tif
#

DATA_DIR = Path(r"C:\GEO-AI\BASIN_DATASETS")


# ============================================================
# OUTPUT DIRECTORY
# ============================================================
#
# Temporary clipping output.
#

OUTPUT_DIR = (
    BASE_DIR
    / "backend"
    / "output"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# PREVIEW DIRECTORY
# ============================================================
#
# Preview sebenarnya sekarang dilayani oleh GitHub Pages.
#
# Struktur tetap dipertahankan untuk local/backend testing:
#
# bathymetry-viewer/
# └── preview/
#     ├── esrgan/
#     │   ├── z0/
#     │   ├── z1/
#     │   └── z2/
#     │
#     └── gebco/
#         ├── z0/
#         ├── z1/
#         └── z2/
#

PREVIEW_DIR = (
    BASE_DIR
    / "preview"
)

PREVIEW_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# DATASET REGISTRY
# ============================================================

DATASETS = {

    "gebco":
        DATA_DIR / "gebco.tif",

    "esrgan":
        DATA_DIR / "esrgan.tif",

}


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(

    title="BASIN Bathymetry API",

    version="1.0.0"

)


# ============================================================
# CORS
# ============================================================
#
# Frontend:
# https://bjorwii.github.io/basin-bathymetry-viewer/
#
# Browser origin:
# https://bjorwii.github.io
#
# Backend:
# Cloudflare Quick Tunnel
#
# Tidak menggunakan cookie/session authentication,
# sehingga allow_credentials tidak diperlukan.
#

app.add_middleware(

    CORSMiddleware,

    allow_origins=[
        "https://bjorwii.github.io",
    ],

    allow_credentials=False,

    allow_methods=[
        "GET",
        "POST",
        "OPTIONS",
    ],

    allow_headers=[
        "Content-Type",
        "Accept",
    ],

    expose_headers=[
        "Content-Disposition",
    ],

)


# ============================================================
# STATIC PREVIEW
# ============================================================
#
# Tetap tersedia untuk local testing.
#
# Production frontend sekarang mengambil preview langsung
# dari GitHub Pages.
#

app.mount(

    "/preview",

    StaticFiles(
        directory=PREVIEW_DIR
    ),

    name="preview"

)


# ============================================================
# REQUEST MODEL
# ============================================================

class ClipRequest(BaseModel):

    dataset: str

    north: float

    south: float

    west: float

    east: float


# ============================================================
# TEMPORARY FILE CLEANUP
# ============================================================

def delete_file(
    file_path: Path
):
    """
    Delete temporary clipping output after
    the HTTP response has finished.
    """

    try:

        if file_path.exists():

            file_path.unlink()

            print(
                "[CLEANUP] Deleted:",
                file_path
            )

    except Exception as e:

        print(
            "[CLEANUP] Failed to delete:",
            file_path
        )

        print(
            "[CLEANUP] Error:",
            repr(e)
        )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/")
def root():

    return {

        "name":
            "BASIN Bathymetry API",

        "status":
            "running"

    }


# ============================================================
# GET DATASET PATH
# ============================================================

def get_dataset_path(
    dataset: str
) -> Path:

    dataset_name = (
        dataset
        .lower()
        .strip()
    )


    # --------------------------------------------------------
    # Validate dataset name
    # --------------------------------------------------------

    if dataset_name not in DATASETS:

        raise HTTPException(

            status_code=400,

            detail={

                "message":
                    "Unknown dataset.",

                "requested":
                    dataset_name,

                "available":
                    list(
                        DATASETS.keys()
                    )

            }

        )


    # --------------------------------------------------------
    # Get source path
    # --------------------------------------------------------

    source_path = DATASETS[
        dataset_name
    ]


    # --------------------------------------------------------
    # Check existence
    # --------------------------------------------------------

    if not source_path.exists():

        raise HTTPException(

            status_code=404,

            detail={

                "message":
                    "Original raster not found.",

                "dataset":
                    dataset_name,

                "expected_path":
                    str(source_path)

            }

        )


    # --------------------------------------------------------
    # Check file
    # --------------------------------------------------------

    if not source_path.is_file():

        raise HTTPException(

            status_code=500,

            detail={

                "message":
                    "Dataset path is not a file.",

                "dataset":
                    dataset_name,

                "path":
                    str(source_path)

            }

        )


    return source_path


# ============================================================
# CLIP RASTER
# ============================================================

@app.post("/clip")
def clip_raster(
    request: ClipRequest,
    background_tasks: BackgroundTasks
):

    print()
    print(
        "========================================"
    )

    print(
        "[CLIP] New request"
    )

    print(
        "========================================"
    )


    # ========================================================
    # 1. DATASET
    # ========================================================

    dataset = (
        request.dataset
        .lower()
        .strip()
    )

    print(
        "[CLIP] Dataset:",
        dataset
    )


    source_path = get_dataset_path(
        dataset
    )


    # ========================================================
    # 2. COORDINATES
    # ========================================================

    north = request.north
    south = request.south
    west = request.west
    east = request.east


    print(
        "[CLIP] North:",
        north
    )

    print(
        "[CLIP] South:",
        south
    )

    print(
        "[CLIP] West:",
        west
    )

    print(
        "[CLIP] East:",
        east
    )


    # ========================================================
    # 3. VALIDATE COORDINATES
    # ========================================================

    if north <= south:

        raise HTTPException(

            status_code=400,

            detail=(
                "North must be greater "
                "than South."
            )

        )


    if east <= west:

        raise HTTPException(

            status_code=400,

            detail=(
                "East must be greater "
                "than West."
            )

        )


    # ========================================================
    # 4. UNIQUE TEMPORARY OUTPUT
    # ========================================================

    unique_id = uuid.uuid4().hex

    output_path = (
        OUTPUT_DIR
        / f"{dataset}_{unique_id}.tif"
    )


    print(
        "[CLIP] Source:",
        source_path
    )

    print(
        "[CLIP] Temporary output:",
        output_path
    )


    # ========================================================
    # 5. OPEN SOURCE RASTER
    # ========================================================

    try:

        with rasterio.open(
            source_path
        ) as src:

            # =================================================
            # SOURCE INFORMATION
            # =================================================

            print(
                "[CLIP] CRS:",
                src.crs
            )

            print(
                "[CLIP] Raster size:",
                src.width,
                "x",
                src.height
            )

            print(
                "[CLIP] Resolution:",
                src.res
            )

            print(
                "[CLIP] Raster bounds:",
                src.bounds
            )


            # =================================================
            # CRS VALIDATION
            # =================================================

            if src.crs is None:

                raise HTTPException(

                    status_code=500,

                    detail=(
                        "Source raster does "
                        "not contain CRS "
                        "information."
                    )

                )


            # =================================================
            # RASTER BOUNDS
            # =================================================

            raster_bounds = src.bounds


            # =================================================
            # AOI / RASTER INTERSECTION
            # =================================================

            intersects = not (

                east <=
                raster_bounds.left

                or

                west >=
                raster_bounds.right

                or

                north <=
                raster_bounds.bottom

                or

                south >=
                raster_bounds.top

            )


            if not intersects:

                raise HTTPException(

                    status_code=400,

                    detail={

                        "message":
                            "Selected AOI does "
                            "not intersect "
                            "the raster.",

                        "aoi": {

                            "west":
                                west,

                            "south":
                                south,

                            "east":
                                east,

                            "north":
                                north

                        },

                        "raster_bounds": {

                            "west":
                                raster_bounds.left,

                            "south":
                                raster_bounds.bottom,

                            "east":
                                raster_bounds.right,

                            "north":
                                raster_bounds.top

                        }

                    }

                )


            print(
                "[CLIP] AOI intersects raster."
            )


            # =================================================
            # CREATE PIXEL WINDOW
            # =================================================

            window = from_bounds(

                west,

                south,

                east,

                north,

                transform=src.transform

            )


            print(
                "[CLIP] Raw window:",
                window
            )


            # =================================================
            # ROUND TO PIXEL GRID
            # =================================================

            window = (
                window
                .round_offsets(
                    op="floor"
                )
                .round_lengths(
                    op="ceil"
                )
            )


            # =================================================
            # CLAMP WINDOW TO RASTER
            # =================================================

            full_window = Window(

                col_off=0,

                row_off=0,

                width=src.width,

                height=src.height

            )


            window = (
                window
                .intersection(
                    full_window
                )
            )


            print(
                "[CLIP] Final window:",
                window
            )


            # =================================================
            # VALIDATE WINDOW
            # =================================================

            if (

                window.width <= 0

                or

                window.height <= 0

            ):

                raise HTTPException(

                    status_code=400,

                    detail=(
                        "Selected AOI "
                        "produces an empty "
                        "raster window."
                    )

                )


            print(
                "[CLIP] Window size:",
                window.width,
                "x",
                window.height
            )


            # =================================================
            # READ RASTER
            # =================================================

            data = src.read(
                window=window
            )


            print(
                "[CLIP] Data shape:",
                data.shape
            )


            # =================================================
            # VALIDATE DATA
            # =================================================

            if (

                data.shape[1] <= 0

                or

                data.shape[2] <= 0

            ):

                raise HTTPException(

                    status_code=400,

                    detail=(
                        "Raster read "
                        "returned an "
                        "empty dataset."
                    )

                )


            # =================================================
            # NEW TRANSFORM
            # =================================================

            transform = (
                src.window_transform(
                    window
                )
            )


            # =================================================
            # OUTPUT PROFILE
            # =================================================

            profile = (
                src.profile.copy()
            )


            profile.update({

                "width":
                    data.shape[2],

                "height":
                    data.shape[1],

                "transform":
                    transform,

            })


            # =================================================
            # WRITE TEMPORARY TIFF
            # =================================================

            with rasterio.open(

                output_path,

                "w",

                **profile

            ) as dst:

                dst.write(
                    data
                )


            print(
                "[CLIP] Temporary TIFF "
                "written successfully."
            )

            print(
                "[CLIP] Output size:",
                data.shape[2],
                "x",
                data.shape[1]
            )


    except HTTPException:

        # ----------------------------------------------------
        # Remove partially created file
        # ----------------------------------------------------

        if output_path.exists():

            try:

                output_path.unlink()

                print(
                    "[CLEANUP] Deleted partial output:",
                    output_path
                )

            except Exception as cleanup_error:

                print(
                    "[CLIP] Cleanup warning:",
                    cleanup_error
                )


        raise


    except Exception as e:

        print(
            "[CLIP] ERROR:",
            repr(e)
        )


        # ----------------------------------------------------
        # Remove partial output
        # ----------------------------------------------------

        if output_path.exists():

            try:

                output_path.unlink()

                print(
                    "[CLEANUP] Deleted failed output:",
                    output_path
                )

            except Exception as cleanup_error:

                print(
                    "[CLIP] Cleanup warning:",
                    cleanup_error
                )


        raise HTTPException(

            status_code=500,

            detail={

                "message":
                    "Raster clipping failed.",

                "error":
                    str(e)

            }

        )


    # ========================================================
    # 6. SCHEDULE CLEANUP
    # ========================================================

    background_tasks.add_task(

        delete_file,

        output_path

    )


    # ========================================================
    # 7. RETURN TIFF
    # ========================================================

    print(
        "[CLIP] Returning TIFF..."
    )

    print(
        "========================================"
    )


    return FileResponse(

        path=output_path,

        media_type="image/tiff",

        filename=(
            f"{dataset}_clipped.tif"
        )

    )