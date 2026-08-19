/* ============================================================
   BASIN - BATHYMETRY MAP
   ============================================================ */


/* ============================================================
   0. BACKEND CONFIGURATION
   ============================================================ */

const API_BASE_URL = CONFIG.API_BASE_URL;

const CLIP_ENDPOINT =
    `${API_BASE_URL}/clip`;

const PREVIEW_BASE_URL =
    "/basin-bathymetry-viewer/preview";


/* ============================================================
   1. MAP INITIALIZATION
   ============================================================ */

const map = L.map("map", {

    minZoom: 2,

    maxZoom: 18,

    zoomControl: false,

    worldCopyJump: true

}).setView(
    [-2.482133, 118.015137],
    5
);


/* ============================================================
   2. SATELLITE BASEMAP
   ============================================================ */

const satellite = L.tileLayer(

    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",

    {
        maxZoom: 18,

        attribution:
            "Tiles &copy; Esri"
    }

);

satellite.addTo(map);


/* ============================================================
   3. PREVIEW DATASET CONFIGURATION
   ============================================================ */


/* ============================================================
   ESRGAN
   ============================================================

   Original raster:
       Width      : 86400
       Height     : 36000
       Resolution : 0.0006944444444444444°

   Bounds:
       West  : 90°
       South : -15°
       East  : 150°
       North : 10°

   Tile:
       1024 × 1024

   Pyramid:

       z0 = 1/16
            5400 × 2250
            6 × 3 = 18 tiles

       z1 = 1/8
            10800 × 4500
            11 × 5 = 55 tiles

       z2 = 1/4
            21600 × 9000
            22 × 9 = 198 tiles

   ============================================================ */

const ESRGAN_CONFIG = {

    name: "ESRGAN",

    path: "esrgan",

    bounds: {

        west: 90.0,

        south: -15.0,

        east: 150.0,

        north: 10.0

    },

    originalWidth: 86400,

    originalHeight: 36000,

    tileSize: 1024,

    levels: {

        0: {

            scale: 16,

            width: 5400,

            height: 2250,

            tilesX: 6,

            tilesY: 3

        },

        1: {

            scale: 8,

            width: 10800,

            height: 4500,

            tilesX: 11,

            tilesY: 5

        },

        2: {

            scale: 4,

            width: 21600,

            height: 9000,

            tilesX: 22,

            tilesY: 9

        }

    }

};


/* ============================================================
   GEBCO
   ============================================================

   Original raster:
       Width      : 14400
       Height     : 6000
       Resolution : 0.004166666666666667°

   CRS:
       EPSG:4326

   Bounds:
       West  : 90°
       South : -15°
       East  : 150°
       North : 10°

   Tile:
       1024 × 1024

   Pyramid:

       z0 = 1/16
            900 × 375
            1 × 1 = 1 tile

       z1 = 1/8
            1800 × 750
            2 × 1 = 2 tiles

       z2 = 1/4
            3600 × 1500
            4 × 2 = 8 tiles

   Total:
       11 PNG tiles

   ============================================================ */

const GEBCO_CONFIG = {

    name: "GEBCO",

    path: "gebco",

    bounds: {

        west: 90.0,

        south: -15.0,

        east: 150.0,

        north: 10.0

    },

    originalWidth: 14400,

    originalHeight: 6000,

    tileSize: 1024,

    levels: {

        0: {

            scale: 16,

            width: 900,

            height: 375,

            tilesX: 1,

            tilesY: 1

        },

        1: {

            scale: 8,

            width: 1800,

            height: 750,

            tilesX: 2,

            tilesY: 1

        },

        2: {

            scale: 4,

            width: 3600,

            height: 1500,

            tilesX: 4,

            tilesY: 2

        }

    }

};


/* ============================================================
   4. RASTER VARIABLES
   ============================================================ */

let esrganLayer = null;

let gebcoLayer = null;

let esrganCurrentLevel = null;

let gebcoCurrentLevel = null;


/* ============================================================
   5. PREVIEW CACHE
   ============================================================ */

const previewLevelCache = {

    esrgan: {},

    gebco: {}

};


/* ============================================================
   6. DRAWING VARIABLES
   ============================================================ */

const drawnItems =
    new L.FeatureGroup();

map.addLayer(
    drawnItems
);

let drawnPolygon = null;

let selectedGeometry = null;


/* ============================================================
   7. UI ELEMENTS
   ============================================================ */

const gebcoToggle =
    document.getElementById(
        "gebco-toggle"
    );

const esrganToggle =
    document.getElementById(
        "esrgan-toggle"
    );

const drawButton =
    document.getElementById(
        "draw-button"
    );

const closeButton =
    document.getElementById(
        "close-area"
    );

const downloadButton =
    document.getElementById(
        "download-button"
    );

const northInput =
    document.getElementById(
        "north"
    );

const southInput =
    document.getElementById(
        "south"
    );

const westInput =
    document.getElementById(
        "west"
    );

const eastInput =
    document.getElementById(
        "east"
    );


/* ============================================================
   8. GET DATASET CONFIG
   ============================================================ */

function getDatasetConfig(
    dataset
) {

    if (
        dataset === "esrgan"
    ) {

        return ESRGAN_CONFIG;

    }

    if (
        dataset === "gebco"
    ) {

        return GEBCO_CONFIG;

    }

    return null;

}


/* ============================================================
   9. CREATE TILE BOUNDS
   ============================================================ */

function getTileBounds(
    config,
    level,
    tileX,
    tileY
) {

    const levelInfo =
        config.levels[level];

    if (!levelInfo) {

        return null;

    }


    const rasterBounds =
        config.bounds;

    const rasterWidth =
        levelInfo.width;

    const rasterHeight =
        levelInfo.height;


    /*
     * Geographic resolution at this preview level.
     */

    const lonPerPixel =
        (
            rasterBounds.east -
            rasterBounds.west
        ) /
        rasterWidth;

    const latPerPixel =
        (
            rasterBounds.north -
            rasterBounds.south
        ) /
        rasterHeight;


    /*
     * Pixel origin.
     *
     * PNG tile rows start from the top.
     */

    const pixelX =
        tileX *
        config.tileSize;

    const pixelY =
        tileY *
        config.tileSize;


    /*
     * Actual tile dimensions.
     *
     * Important for edge tiles that are smaller
     * than 1024 × 1024.
     */

    const remainingWidth =
        rasterWidth -
        pixelX;

    const remainingHeight =
        rasterHeight -
        pixelY;

    const tileWidth =
        Math.min(
            config.tileSize,
            remainingWidth
        );

    const tileHeight =
        Math.min(
            config.tileSize,
            remainingHeight
        );


    if (
        tileWidth <= 0 ||
        tileHeight <= 0
    ) {

        return null;

    }


    /*
     * Geographic extent of tile.
     */

    const west =
        rasterBounds.west +
        pixelX *
        lonPerPixel;

    const east =
        west +
        tileWidth *
        lonPerPixel;


    const north =
        rasterBounds.north -
        pixelY *
        latPerPixel;

    const south =
        north -
        tileHeight *
        latPerPixel;


    return L.latLngBounds(

        L.latLng(
            south,
            west
        ),

        L.latLng(
            north,
            east
        )

    );

}


/* ============================================================
   10. CREATE IMAGE TILE
   ============================================================ */

function createImageTile(
    config,
    level,
    tileX,
    tileY
) {

    const bounds =
        getTileBounds(
            config,
            level,
            tileX,
            tileY
        );


    if (!bounds) {

        return null;

    }


    const url =
        `${PREVIEW_BASE_URL}` +
        `/${config.path}` +
        `/z${level}` +
        `/${tileX}_${tileY}.png`;


    /*
     * ImageOverlay is intentional.
     *
     * The PNG previews are geographic EPSG:4326
     * images and are NOT normal Web Mercator XYZ tiles.
     */

    const imageOverlay =
        L.imageOverlay(
            url,
            bounds,
            {

                opacity: 0.85,

                interactive: false,

                crossOrigin: true

            }
        );


    return imageOverlay;

}


/* ============================================================
   11. CREATE DATASET LEVEL
   ============================================================ */

function createDatasetLevel(
    config,
    level
) {

    if (
        previewLevelCache[
            config.path
        ][level]
    ) {

        return (
            previewLevelCache[
                config.path
            ][level]
        );

    }


    const levelInfo =
        config.levels[level];


    if (!levelInfo) {

        console.warn(
            `[${config.name}] ` +
            `Level ${level} does not exist.`
        );

        return null;

    }


    const layerGroup =
        L.layerGroup();


    /*
     * Create all tiles for this level.
     */

    for (
        let y = 0;
        y < levelInfo.tilesY;
        y++
    ) {

        for (
            let x = 0;
            x < levelInfo.tilesX;
            x++
        ) {

            const tile =
                createImageTile(
                    config,
                    level,
                    x,
                    y
                );


            if (tile) {

                layerGroup.addLayer(
                    tile
                );

            }

        }

    }


    previewLevelCache[
        config.path
    ][level] =
        layerGroup;


    console.log(
        `[${config.name}] ` +
        `Preview level ${level} created.`
    );


    return layerGroup;

}


/* ============================================================
   12. REMOVE DATASET LAYERS
   ============================================================ */

function removeDatasetLayer(
    config
) {

    const cache =
        previewLevelCache[
            config.path
        ];


    Object.keys(
        cache
    ).forEach(
        function(level) {

            const layer =
                cache[level];


            if (
                layer &&
                map.hasLayer(layer)
            ) {

                map.removeLayer(
                    layer
                );

            }

        }
    );


    if (
        config.path === "esrgan"
    ) {

        esrganCurrentLevel =
            null;

        esrganLayer =
            null;

    }


    if (
        config.path === "gebco"
    ) {

        gebcoCurrentLevel =
            null;

        gebcoLayer =
            null;

    }

}


/* ============================================================
   13. MAP ZOOM → PREVIEW LEVEL
   ============================================================ */

function getPreviewLevel(
    mapZoom
) {

    /*
     * z0:
     * lowest resolution
     */

    if (
        mapZoom <= 5
    ) {

        return 0;

    }


    /*
     * z1:
     * medium resolution
     */

    if (
        mapZoom <= 8
    ) {

        return 1;

    }


    /*
     * z2:
     * highest available preview resolution
     */

    return 2;

}


/* ============================================================
   14. SHOW PREVIEW LEVEL
   ============================================================ */

function showPreviewLevel(
    config,
    level
) {

    const layer =
        createDatasetLevel(
            config,
            level
        );


    if (!layer) {

        return;

    }


    const currentLevel =
        config.path === "esrgan"
            ? esrganCurrentLevel
            : gebcoCurrentLevel;


    /*
     * Remove old level.
     */

    if (
        currentLevel !== null &&
        currentLevel !== level
    ) {

        const oldLayer =
            previewLevelCache[
                config.path
            ][currentLevel];


        if (
            oldLayer &&
            map.hasLayer(oldLayer)
        ) {

            map.removeLayer(
                oldLayer
            );

        }

    }


    /*
     * Add new level.
     */

    if (
        !map.hasLayer(layer)
    ) {

        layer.addTo(map);

    }


    /*
     * Save active level.
     */

    if (
        config.path === "esrgan"
    ) {

        esrganCurrentLevel =
            level;

        esrganLayer =
            layer;

    }


    if (
        config.path === "gebco"
    ) {

        gebcoCurrentLevel =
            level;

        gebcoLayer =
            layer;

    }


    console.log(
        `[${config.name}] ` +
        `Showing preview level ${level}.`
    );

}


/* ============================================================
   15. GEBCO
   ============================================================ */

function addGEBCOLayer() {

    /*
     * Remove ESRGAN first.
     */

    if (
        esrganToggle.checked
    ) {

        esrganToggle.checked =
            false;

        removeESRGANLayer();

    }


    const config =
        GEBCO_CONFIG;


    const level =
        getPreviewLevel(
            map.getZoom()
        );


    showPreviewLevel(
        config,
        level
    );


    /*
     * Fit to actual GEBCO bounds.
     */

    const bounds =
        L.latLngBounds(

            [
                config.bounds.south,
                config.bounds.west
            ],

            [
                config.bounds.north,
                config.bounds.east
            ]

        );


    if (
        bounds.isValid()
    ) {

        map.fitBounds(
            bounds,
            {

                padding:
                    [30, 30],

                maxZoom:
                    5

            }
        );

    }


    console.log(
        "[GEBCO] Preview layer added."
    );

}


function removeGEBCOLayer() {

    removeDatasetLayer(
        GEBCO_CONFIG
    );


    console.log(
        "[GEBCO] Preview layer removed."
    );

}


/* ============================================================
   16. ESRGAN
   ============================================================ */

function addESRGANLayer() {

    /*
     * Remove GEBCO first.
     */

    if (
        gebcoToggle.checked
    ) {

        gebcoToggle.checked =
            false;

        removeGEBCOLayer();

    }


    const config =
        ESRGAN_CONFIG;


    const level =
        getPreviewLevel(
            map.getZoom()
        );


    showPreviewLevel(
        config,
        level
    );


    /*
     * Fit to actual ESRGAN bounds.
     */

    const bounds =
        L.latLngBounds(

            [
                config.bounds.south,
                config.bounds.west
            ],

            [
                config.bounds.north,
                config.bounds.east
            ]

        );


    if (
        bounds.isValid()
    ) {

        map.fitBounds(
            bounds,
            {

                padding:
                    [30, 30],

                maxZoom:
                    5

            }
        );

    }


    console.log(
        "[ESRGAN] Preview layer added."
    );

}


function removeESRGANLayer() {

    removeDatasetLayer(
        ESRGAN_CONFIG
    );


    console.log(
        "[ESRGAN] Preview layer removed."
    );

}


/* ============================================================
   17. CHANGE PREVIEW LEVEL ON ZOOM
   ============================================================ */

map.on(
    "zoomend",
    function() {

        const activeDataset =
            getActiveDataset();


        if (!activeDataset) {

            return;

        }


        const config =
            getDatasetConfig(
                activeDataset
            );


        if (!config) {

            return;

        }


        const level =
            getPreviewLevel(
                map.getZoom()
            );


        const currentLevel =
            config.path === "esrgan"
                ? esrganCurrentLevel
                : gebcoCurrentLevel;


        if (
            currentLevel !== level
        ) {

            showPreviewLevel(
                config,
                level
            );

        }

    }
);


/* ============================================================
   18. GET ACTIVE DATASET
   ============================================================ */

function getActiveDataset() {

    if (
        esrganToggle.checked
    ) {

        return "esrgan";

    }


    if (
        gebcoToggle.checked
    ) {

        return "gebco";

    }


    return null;

}


/* ============================================================
   19. DOWNLOAD BUTTON STATE
   ============================================================ */

function updateDownloadButtonState() {

    const hasAOI =
        Boolean(
            drawnPolygon &&
            selectedGeometry
        );


    const hasDataset =
        Boolean(
            getActiveDataset()
        );


    downloadButton.disabled =
        !(
            hasAOI &&
            hasDataset
        );

}


/* ============================================================
   20. GEBCO CHECKBOX
   ============================================================ */

gebcoToggle.addEventListener(
    "change",
    function() {

        if (
            this.checked
        ) {

            if (
                esrganToggle.checked
            ) {

                esrganToggle.checked =
                    false;

                removeESRGANLayer();

            }


            addGEBCOLayer();

        } else {

            removeGEBCOLayer();

        }


        updateDownloadButtonState();

    }
);


/* ============================================================
   21. ESRGAN CHECKBOX
   ============================================================ */

esrganToggle.addEventListener(
    "change",
    function() {

        if (
            this.checked
        ) {

            if (
                gebcoToggle.checked
            ) {

                gebcoToggle.checked =
                    false;

                removeGEBCOLayer();

            }


            addESRGANLayer();

        } else {

            removeESRGANLayer();

        }


        updateDownloadButtonState();

    }
);


/* ============================================================
   22. MAP STATUS
   ============================================================ */

const latElement =
    document.getElementById(
        "map-lat"
    );

const lonElement =
    document.getElementById(
        "map-lon"
    );

const zoomElement =
    document.getElementById(
        "map-zoom"
    );


function updateMapStatus() {

    const center =
        map.getCenter();

    const zoom =
        map.getZoom();


    latElement.textContent =
        `${center.lat.toFixed(6)}°`;

    lonElement.textContent =
        `${center.lng.toFixed(6)}°`;

    zoomElement.textContent =
        zoom;

}


map.on(
    "move",
    updateMapStatus
);

map.on(
    "zoomend",
    updateMapStatus
);

updateMapStatus();


/* ============================================================
   23. DRAW RECTANGLE AOI
   ============================================================ */

drawButton.addEventListener(
    "click",
    function() {

        drawnItems.clearLayers();

        drawnPolygon = null;

        selectedGeometry = null;

        downloadButton.disabled =
            true;


        const rectangleDrawer =
            new L.Draw.Rectangle(
                map,
                {

                    shapeOptions: {

                        color:
                            "#a62e2b",

                        weight:
                            2,

                        fillOpacity:
                            0.20

                    }

                }
            );


        rectangleDrawer.enable();

    }
);


/* ============================================================
   24. RECTANGLE CREATED
   ============================================================ */

map.on(
    L.Draw.Event.CREATED,
    function(event) {

        if (
            event.layerType !==
            "rectangle"
        ) {

            return;

        }


        drawnItems.clearLayers();


        drawnPolygon =
            event.layer;


        drawnItems.addLayer(
            drawnPolygon
        );


        selectedGeometry =
            drawnPolygon.toGeoJSON();


        updateCoordinateFields(
            drawnPolygon
        );


        updateDownloadButtonState();

    }
);


/* ============================================================
   25. UPDATE COORDINATE FIELDS
   ============================================================ */

function updateCoordinateFields(
    layer
) {

    const bounds =
        layer.getBounds();


    northInput.value =
        bounds
            .getNorth()
            .toFixed(6);


    southInput.value =
        bounds
            .getSouth()
            .toFixed(6);


    westInput.value =
        bounds
            .getWest()
            .toFixed(6);


    eastInput.value =
        bounds
            .getEast()
            .toFixed(6);

}


/* ============================================================
   26. CLOSE AREA
   ============================================================ */

closeButton.addEventListener(
    "click",
    function() {

        drawnItems.clearLayers();

        drawnPolygon = null;

        selectedGeometry = null;


        northInput.value = "";

        southInput.value = "";

        westInput.value = "";

        eastInput.value = "";


        downloadButton.disabled =
            true;

    }
);


/* ============================================================
   27. DOWNLOAD - FASTAPI CLIPPING
   ============================================================ */

downloadButton.addEventListener(
    "click",
    async function() {

        if (
            !drawnPolygon ||
            !selectedGeometry
        ) {

            alert(
                "Please select an area first."
            );

            return;

        }


        const dataset =
            getActiveDataset();


        if (!dataset) {

            alert(
                "Please select GEBCO or ESRGAN first."
            );

            return;

        }


        const bounds =
            drawnPolygon.getBounds();


        const requestBody = {

            dataset:
                dataset,

            north:
                bounds.getNorth(),

            south:
                bounds.getSouth(),

            west:
                bounds.getWest(),

            east:
                bounds.getEast()

        };


        downloadButton.disabled =
            true;


        const originalText =
            downloadButton.textContent;


        downloadButton.textContent =
            "Preparing...";


        try {

            const response =
                await fetch(
                    CLIP_ENDPOINT,
                    {

                        method:
                            "POST",

                        headers: {

                            "Content-Type":
                                "application/json",

                            "Accept":
                                "image/tiff"

                        },

                        body:
                            JSON.stringify(
                                requestBody
                            )

                    }
                );


            if (
                !response.ok
            ) {

                let errorMessage =
                    `Server returned HTTP ${response.status}.`;


                try {

                    const errorData =
                        await response.json();


                    if (
                        errorData.detail
                    ) {

                        if (
                            typeof
                            errorData.detail
                            ===
                            "string"
                        ) {

                            errorMessage =
                                errorData.detail;

                        } else {

                            errorMessage =
                                JSON.stringify(
                                    errorData.detail,
                                    null,
                                    2
                                );

                        }

                    }

                } catch (
                    parseError
                ) {

                    console.warn(
                        "Could not parse backend error:",
                        parseError
                    );

                }


                throw new Error(
                    errorMessage
                );

            }


            const blob =
                await response.blob();


            if (
                blob.size === 0
            ) {

                throw new Error(
                    "Backend returned an empty TIFF file."
                );

            }


            const downloadUrl =
                URL.createObjectURL(
                    blob
                );


            const link =
                document.createElement(
                    "a"
                );


            link.href =
                downloadUrl;


            link.download =
                `${dataset}_clipped.tif`;


            link.style.display =
                "none";


            document.body.appendChild(
                link
            );


            link.click();


            link.remove();


            URL.revokeObjectURL(
                downloadUrl
            );


            console.log(
                `[DOWNLOAD] ` +
                `${dataset}_clipped.tif ` +
                `download started.`
            );


        } catch (
            error
        ) {

            console.error(
                "[DOWNLOAD] Failed:",
                error
            );


            alert(
                `Download failed:\n\n${error.message}`
            );


        } finally {

            downloadButton.textContent =
                originalText;


            updateDownloadButtonState();

        }

    }
);


/* ============================================================
   28. START APPLICATION
   ============================================================ */

async function startApplication() {

    gebcoToggle.checked =
        false;

    esrganToggle.checked =
        false;


    drawnItems.clearLayers();

    drawnPolygon = null;

    selectedGeometry = null;


    downloadButton.disabled =
        true;


    /*
     * Original TIFF files are NEVER loaded
     * into the browser.
     *
     * Browser only requests PNG preview tiles.
     *
     * Download still uses the original TIFF
     * through FastAPI /clip.
     */


    console.log(
        "===================================="
    );

    console.log(
        "BASIN application ready."
    );

    console.log(
        "[BACKEND]",
        API_BASE_URL
    );

    console.log(
        "[PREVIEW]",
        PREVIEW_BASE_URL
    );

    console.log(
        "[ESRGAN]",
        ESRGAN_CONFIG.bounds
    );

    console.log(
        "[GEBCO]",
        GEBCO_CONFIG.bounds
    );

    console.log(
        "===================================="

    );

}


startApplication();