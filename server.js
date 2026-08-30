
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
// ANALYSER UN LIEN DIRECT
// ======================================================

async function getVideoInfo(url) {
    try {
        const response = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            headers: {
                "User-Agent": "VideoHub/1.0"
            }
        });

        const contentType =
            response.headers.get("content-type") || "";

        const contentLength =
            response.headers.get("content-length") || null;

        return {
            success: response.ok,
            contentType,
            contentLength,
            status: response.status
        };

    } catch (error) {
        console.log(
            "Erreur analyse lien :",
            error.message
        );

        return {
            success: false,
            message: "Impossible de vérifier le fichier."
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

    const parsedUrl = parseHttpUrl(url);

    if (!parsedUrl) {
        return res.json({
            success: false,
            message: "Lien invalide."
        });
    }

    const platform = detectPlatform(url);

    let info = null;

    // Pour les liens directs, on vérifie le fichier.
    if (platform === "Lien direct") {
        info = await getVideoInfo(url);
    }

    console.log(
        `Plateforme détectée : ${platform}`
    );

    return res.json({
        success: true,
        platform,
        contentType: info
            ? info.contentType
            : null,
        contentLength: info
            ? info.contentLength
            : null
    });
});

// ======================================================
// NOM DE FICHIER SÉCURISÉ
// ======================================================

function getSafeFilename(url, contentType) {

    try {
        const parsed = new URL(url);

        let filename = path.basename(
            decodeURIComponent(parsed.pathname)
        );

        filename = filename
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
            .trim();

        if (!filename || filename === ".") {
            filename = "VideoHub-video";
        }

        // Si aucun nom ne possède d'extension,
        // on peut en ajouter une selon le type.
        if (!filename.includes(".")) {

            if (contentType.includes("mp4")) {
                filename += ".mp4";
            } else if (contentType.includes("webm")) {
                filename += ".webm";
            } else if (contentType.includes("mpeg")) {
                filename += ".mp3";
            }
        }

        return filename;

    } catch {
        return "VideoHub-video";
    }
}

// ======================================================
// TÉLÉCHARGEMENT PAR HTTP/HTTPS
// ======================================================

function downloadDirectFile(url, res, redirectCount = 0) {

    // Protection contre les redirections infinies.
    if (redirectCount > 5) {
        return res.status(400).send(
            "Trop de redirections."
        );
    }

    const parsedUrl = parseHttpUrl(url);

    if (!parsedUrl) {
        return res.status(400).send(
            "Lien invalide."
        );
    }

    const protocol =
        parsedUrl.protocol === "https:"
            ? https
            : http;

    const request = protocol.get(
        parsedUrl.href,
        {
            headers: {
                "User-Agent": "VideoHub/1.0",
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

                return res.status(400).send(
                    "Impossible de récupérer le fichier."
                );
            }

            // ==================================================
            // INFORMATIONS DU FICHIER
            // ==================================================

            const contentType =
                response.headers["content-type"] ||
                "application/octet-stream";

            const contentLength =
                response.headers["content-length"];

            const filename =
                getSafeFilename(
                    parsedUrl.href,
                    contentType
                );

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

            response.on("error", (error) => {

                console.log(
                    "Erreur pendant le transfert :",
                    error.message
                );

                if (!res.headersSent) {
                    res.status(500).send(
                        "Erreur pendant le téléchargement."
                    );
                } else {
                    res.destroy();
                }
            });
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
                res.status(504).send(
                    "Le téléchargement a pris trop de temps."
                );
            }
        }
    );

    // ======================================================
    // ERREUR DE CONNEXION
    // ======================================================

    request.on("error", (error) => {

        console.log(
            "Erreur téléchargement :",
            error.message
        );

        if (!res.headersSent) {
            res.status(500).send(
                "Erreur pendant le téléchargement."
            );
        }
    });
}

// ======================================================
// API DOWNLOAD-URL
// ======================================================

app.get("/api/download-url", (req, res) => {

    const url = req.query.url;

    if (!url) {
        return res.status(400).send(
            "Lien manquant."
        );
    }

    downloadDirectFile(url, res);
});

// ======================================================
// API DOWNLOAD AVEC FETCH
// ======================================================

app.get("/api/download", async (req, res) => {

    const url = req.query.url;

    if (!url) {
        return res.status(400).send(
            "Aucun lien fourni."
        );
    }

    const parsedUrl = parseHttpUrl(url);

    if (!parsedUrl) {
        return res.status(400).send(
            "Lien invalide."
        );
    }

    try {

        const response = await fetch(
            parsedUrl.href,
            {
                redirect: "follow",
                headers: {
                    "User-Agent": "VideoHub/1.0",
                    "Accept": "*/*"
                }
            }
        );

        if (!response.ok) {
            return res.status(400).send(
                "Impossible de télécharger ce fichier."
            );
        }

        const contentType =
            response.headers.get(
                "content-type"
            ) ||
            "application/octet-stream";

        const contentLength =
            response.headers.get(
                "content-length"
            );

        const filename =
            getSafeFilename(
                response.url || parsedUrl.href,
                contentType
            );

        res.setHeader(
            "Content-Type",
            contentType
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
        );

        if (contentLength) {
            res.setHeader(
                "Content-Length",
                contentLength
            );
        }

        if (!response.body) {
            return res.status(500).send(
                "Aucun fichier reçu."
            );
        }

        const reader =
            response.body.getReader();

        while (true) {

            const {
                done,
                value
            } = await reader.read();

            if (done) {
                break;
            }

            res.write(value);
        }

        res.end();

    } catch (error) {

        console.error(
            "Erreur téléchargement :",
            error.message
        );

        if (!res.headersSent) {
            res.status(500).send(
                "Erreur pendant le téléchargement."
            );
        } else {
            res.destroy();
        }
    }
});

// ======================================================
// ROUTE 404 API
// ======================================================

app.use("/api", (req, res) => {

    res.status(404).json({
        success: false,
        message: "Route API introuvable."
    });
});

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

