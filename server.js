
const express = require("express");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(express.json({ limit: "1mb" }));

// ======================================================
// FICHIERS DU SITE
// ======================================================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/robots.txt", (req, res) => {
    res.sendFile(path.join(__dirname, "robots.txt"));
});

app.get("/sitemap.xml", (req, res) => {
    res.sendFile(path.join(__dirname, "sitemap.xml"));
});

// ======================================================
// VÉRIFICATION D'URL
// ======================================================

function parseHttpUrl(value) {
    try {
        const url = new URL(value);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            return null;
        }

        return url;
    } catch {
        return null;
    }
}

// ======================================================
// DÉTECTION DE PLATEFORME
// ======================================================

function detectPlatform(url) {
    const parsed = parseHttpUrl(url);

    if (!parsed) {
        return null;
    }

    const host = parsed.hostname
        .toLowerCase()
        .replace(/^www\./, "");

    if (
        host === "youtube.com" ||
        host === "youtu.be" ||
        host.endsWith(".youtube.com")
    ) {
        return "YouTube";
    }

    if (
        host === "tiktok.com" ||
        host.endsWith(".tiktok.com")
    ) {
        return "TikTok";
    }

    if (
        host === "twitter.com" ||
        host === "x.com" ||
        host.endsWith(".twitter.com") ||
        host.endsWith(".x.com")
    ) {
        return "X / Twitter";
    }

    if (
        host === "snapchat.com" ||
        host.endsWith(".snapchat.com")
    ) {
        return "Snapchat";
    }

    return "Lien direct";
}

// ======================================================
// VÉRIFICATION D'UN FICHIER DIRECT
// ======================================================

async function getVideoInfo(url) {
    try {
        let response;

        // Certains serveurs refusent HEAD.
        // On essaie d'abord HEAD.
        try {
            response = await fetch(url, {
                method: "HEAD",
                redirect: "follow",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 VideoHub/2.0",
                    "Accept": "*/*"
                }
            });
        } catch {
            response = null;
        }

        // Si HEAD ne fonctionne pas, petite requête GET.
        if (!response || !response.ok) {
            response = await fetch(url, {
                method: "GET",
                redirect: "follow",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 VideoHub/2.0",
                    "Accept": "*/*",
                    "Range": "bytes=0-0"
                }
            });
        }

        const contentType =
            response.headers.get("content-type") || "";

        const contentLength =
            response.headers.get("content-length") || null;

        return {
            success: response.ok,
            contentType,
            contentLength,
            status: response.status,
            finalUrl: response.url || url,
            isVideo:
                contentType
                    .toLowerCase()
                    .startsWith("video/")
        };

    } catch (error) {

        console.log(
            "Erreur analyse lien :",
            error.message
        );

        return {
            success: false,
            message:
                "Impossible de vérifier le fichier."
        };
    }
}

// ======================================================
// API ANALYSE
// ======================================================

app.post("/api/analyze", async (req, res) => {

    const url = req.body?.url;

    if (!url) {
        return res.json({
            success: false,
            message: "Aucun lien fourni."
        });
    }

    const parsedUrl =
        parseHttpUrl(url);

    if (!parsedUrl) {
        return res.json({
            success: false,
            message: "Lien invalide."
        });
    }

    const platform =
        detectPlatform(url);

    let info = null;

    // Pour les liens directs,
    // on vérifie réellement le fichier.
    if (platform === "Lien direct") {
        info = await getVideoInfo(url);
    }

    console.log(
        `Plateforme détectée : ${platform}`
    );

    return res.json({
        success: true,
        platform,

        contentType:
            info
                ? info.contentType
                : null,

        contentLength:
            info
                ? info.contentLength
                : null,

        isVideo:
            info
                ? info.isVideo
                : false,

        downloadable:
            info
                ? info.success &&
                  info.isVideo
                : false,

        finalUrl:
            info
                ? info.finalUrl
                : null
    });
});

// ======================================================
// NOM DE FICHIER SÉCURISÉ
// ======================================================

function getSafeFilename(url, contentType) {

    try {

        const parsed =
            new URL(url);

        let filename =
            path.basename(
                decodeURIComponent(
                    parsed.pathname
                )
            );

        filename = filename
            .replace(
                /[<>:"/\\|?*\x00-\x1F]/g,
                ""
            )
            .trim();

        if (
            !filename ||
            filename === "."
        ) {
            filename =
                "VideoHub-video";
        }

        // Si le fichier n'a pas d'extension,
        // on en ajoute une selon le type.
        if (!path.extname(filename)) {

            const type =
                (contentType || "")
                    .toLowerCase();

            if (type.includes("mp4")) {
                filename += ".mp4";
            }

            else if (
                type.includes("webm")
            ) {
                filename += ".webm";
            }

            else if (
                type.includes("ogg")
            ) {
                filename += ".ogv";
            }

            else if (
                type.includes("quicktime")
            ) {
                filename += ".mov";
            }

            else {
                filename += ".mp4";
            }
        }

        // Évite les noms trop longs.
        if (filename.length > 150) {
            filename =
                filename.substring(0, 150);
        }

        return filename;

    } catch {

        return "VideoHub-video.mp4";
    }
}

// ======================================================
// TÉLÉCHARGEMENT DIRECT HTTP / HTTPS
// ======================================================

function downloadDirectFile(
    url,
    res,
    redirectCount = 0
) {

    // Protection contre les redirections infinies.
    if (redirectCount > 5) {

        return res
            .status(400)
            .send(
                "Trop de redirections."
            );
    }

    const parsedUrl =
        parseHttpUrl(url);

    if (!parsedUrl) {

        return res
            .status(400)
            .send(
                "Lien invalide."
            );
    }

    const protocol =
        parsedUrl.protocol === "https:"
            ? https
            : http;

    const request =
        protocol.get(
            parsedUrl.href,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 VideoHub/2.0",

                    "Accept": "*/*"
                }
            },
            (response) => {

                // ==================================================
                // REDIRECTION
                // ==================================================

                if (
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {

                    response.resume();

                    const redirectUrl =
                        new URL(
                            response.headers.location,
                            parsedUrl.href
                        ).href;

                    return downloadDirectFile(
                        redirectUrl,
                        res,
                        redirectCount + 1
                    );
                }

                // ==================================================
                // ERREUR SERVEUR
                // ==================================================

                if (
                    response.statusCode < 200 ||
                    response.statusCode >= 300
                ) {

                    response.resume();

                    return res
                        .status(400)
                        .send(
                            "Impossible de récupérer le fichier."
                        );
                }

                // ==================================================
                // INFORMATIONS DU FICHIER
                // ==================================================

                const contentType =
                    response.headers[
                        "content-type"
                    ] ||
                    "application/octet-stream";

                const contentLength =
                    response.headers[
                        "content-length"
                    ];

                const filename =
                    getSafeFilename(
                        parsedUrl.href,
                        contentType
                    );

                // ==================================================
                // VÉRIFICATION VIDÉO
                // ==================================================

                const isVideo =
                    contentType
                        .toLowerCase()
                        .startsWith("video/");

                if (!isVideo) {

                    response.resume();

                    return res
                        .status(400)
                        .send(
                            "L'URL ne semble pas pointer vers un fichier vidéo."
                        );
                }

                // ==================================================
                // HEADERS DE TÉLÉCHARGEMENT
                // ==================================================

                res.setHeader(
                    "Content-Type",
                    contentType
                );

                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename="${filename}"`
                );

                res.setHeader(
                    "Cache-Control",
                    "no-store"
                );

                if (contentLength) {

                    res.setHeader(
                        "Content-Length",
                        contentLength
                    );
                }

                // ==================================================
                // TRANSFERT DU FICHIER
                // ==================================================

                response.pipe(res);

                response.on(
                    "error",
                    (error) => {

                        console.log(
                            "Erreur pendant le transfert :",
                            error.message
                        );

                        if (
                            !res.headersSent
                        ) {

                            res
                                .status(500)
                                .send(
                                    "Erreur pendant le téléchargement."
                                );

                        } else {

                            res.destroy();
                        }
                    }
                );

                // Si le navigateur annule le téléchargement.
                res.on(
                    "close",
                    () => {

                        if (
                            !res.writableFinished
                        ) {

                            response.destroy();
                        }
                    }
                );
            }
        );

    // ======================================================
    // TIMEOUT
    // ======================================================

    request.setTimeout(
        120000,
        () => {

            request.destroy();

            if (!res.headersSent) {

                res
                    .status(504)
                    .send(
                        "Le téléchargement a pris trop de temps."
                    );
            }
        }
    );

    // ======================================================
    // ERREUR DE CONNEXION
    // ======================================================

    request.on(
        "error",
        (error) => {

            console.log(
                "Erreur téléchargement :",
                error.message
            );

            if (!res.headersSent) {

                res
                    .status(500)
                    .send(
                        "Erreur pendant le téléchargement."
                    );

            } else {

                res.destroy();
            }
        }
    );
}

// ======================================================
// API DOWNLOAD-URL
// ======================================================

app.get(
    "/api/download-url",
    (req, res) => {

        const url =
            req.query.url;

        if (!url) {

            return res
                .status(400)
                .send(
                    "Lien manquant."
                );
        }

        const parsed =
            parseHttpUrl(url);

        if (!parsed) {

            return res
                .status(400)
                .send(
                    "Lien invalide."
                );
        }

        downloadDirectFile(
            parsed.href,
            res
        );
    }
);

// ======================================================
// API DOWNLOAD
// ======================================================

app.get(
    "/api/download",
    async (req, res) => {

        const url =
            req.query.url;

        if (!url) {

            return res
                .status(400)
                .send(
                    "Aucun lien fourni."
                );
        }

        const parsedUrl =
            parseHttpUrl(url);

        if (!parsedUrl) {

            return res
                .status(400)
                .send(
                    "Lien invalide."
                );
        }

        try {

            const response =
                await fetch(
                    parsedUrl.href,
                    {
                        method: "GET",

                        redirect: "follow",

                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 VideoHub/2.0",

                            "Accept": "*/*"
                        }
                    }
                );

            if (!response.ok) {

                return res
                    .status(400)
                    .send(
                        "Impossible de télécharger ce fichier."
                    );
            }

            const contentType =
                response.headers.get(
                    "content-type"
                ) ||
                "application/octet-stream";

            // ==================================================
            // VÉRIFICATION VIDÉO
            // ==================================================

            const isVideo =
                contentType
                    .toLowerCase()
                    .startsWith("video/");

            if (!isVideo) {

                return res
                    .status(400)
                    .send(
                        "L'URL ne pointe pas vers un fichier vidéo."
                    );
            }

            const contentLength =
                response.headers.get(
                    "content-length"
                );

            const filename =
                getSafeFilename(
                    response.url ||
                    parsedUrl.href,
                    contentType
                );

            // ==================================================
            // HEADERS
            // ==================================================

            res.setHeader(
                "Content-Type",
                contentType
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`
            );

            res.setHeader(
                "Cache-Control",
                "no-store"
            );

            if (contentLength) {

                res.setHeader(
                    "Content-Length",
                    contentLength
                );
            }

            // ==================================================
            // BODY
            // ==================================================

            if (!response.body) {

                return res
                    .status(500)
                    .send(
                        "Aucun fichier reçu."
                    );
            }

            const reader =
                response.body.getReader();

            try {

                while (true) {

                    const {
                        done,
                        value
                    } =
                        await reader.read();

                    if (done) {
                        break;
                    }

                    if (!res.write(value)) {

                        await new Promise(
                            resolve =>
                                res.once(
                                    "drain",
                                    resolve
                                )
                        );
                    }
                }

                res.end();

            } catch (streamError) {

                console.error(
                    "Erreur du flux :",
                    streamError.message
                );

                if (!res.headersSent) {

                    res
                        .status(500)
                        .send(
                            "Erreur pendant le téléchargement."
                        );

                } else {

                    res.destroy();
                }
            }

        } catch (error) {

            console.error(
                "Erreur téléchargement :",
                error.message
            );

            if (!res.headersSent) {

                res
                    .status(500)
                    .send(
                        "Erreur pendant le téléchargement."
                    );

            } else {

                res.destroy();
            }
        }
    }
);

// ======================================================
// ROUTE 404 API
// ======================================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "Route API introuvable."
        });
    }
);

// ======================================================
// GESTIONNAIRE D'ERREUR
// ======================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "Erreur serveur :",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res
            .status(500)
            .json({
                success: false,
                message:
                    "Erreur interne du serveur."
            });
    }
);

// ======================================================
// DÉMARRAGE
// ======================================================

app.listen(
    PORT,
    HOST,
    () => {

        console.log(
            `VideoHub fonctionne sur le port ${PORT}`
        );

        console.log(
            `Adresse locale : http://localhost:${PORT}`
        );
    }
);

