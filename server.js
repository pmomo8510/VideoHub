const express = require("express");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();

// Port local ou port fourni par l'hébergeur
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(express.json());

// Fichiers du site
app.use(express.static(__dirname));


// ========================================
// PAGE PRINCIPALE
// ========================================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "index.html")
    );
});


// ========================================
// ANALYSER UN LIEN
// ========================================

async function getVideoInfo(url) {

    try {

        const response = await fetch(url, {
            method: "HEAD",
            redirect: "follow"
        });

        const contentType =
            response.headers.get("content-type") || "";

        const contentLength =
            response.headers.get("content-length") || null;

        return {
            success: true,
            contentType: contentType,
            contentLength: contentLength
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


app.post("/api/analyze", async (req, res) => {

    const url = req.body.url;

    if (!url) {

        return res.json({
            success: false,
            message: "Aucun lien fourni."
        });

    }

    let platform = null;
    let info = null;

    try {

        const link = new URL(url);

        const host =
            link.hostname
                .toLowerCase()
                .replace(/^www\./, "");


        // YouTube
        if (
            host === "youtube.com" ||
            host === "youtu.be" ||
            host.endsWith(".youtube.com")
        ) {

            platform = "YouTube";

        }

        // TikTok
        else if (
            host === "tiktok.com" ||
            host.endsWith(".tiktok.com")
        ) {

            platform = "TikTok";

        }

        // X / Twitter
        else if (
            host === "twitter.com" ||
            host === "x.com" ||
            host.endsWith(".twitter.com") ||
            host.endsWith(".x.com")
        ) {

            platform = "X / Twitter";

        }

        // Snapchat
        else if (
            host === "snapchat.com" ||
            host.endsWith(".snapchat.com")
        ) {

            platform = "Snapchat";

        }

        // Lien vidéo direct
        else {

            info = await getVideoInfo(url);

            platform = "Lien direct";

        }


    } catch (error) {

        return res.json({
            success: false,
            message: "Lien invalide."
        });

    }


    console.log(
        `Plateforme détectée : ${platform}`
    );


    res.json({

        success: true,

        platform: platform,

        contentType:
            info
                ? info.contentType
                : null,

        contentLength:
            info
                ? info.contentLength
                : null

    });

});


// ========================================
// TÉLÉCHARGEMENT D'UN LIEN DIRECT
// ========================================

app.get("/api/download-url", (req, res) => {

    const url = req.query.url;

    if (!url) {

        return res.status(400).send(
            "Lien manquant."
        );

    }


    let parsedUrl;

    try {

        parsedUrl = new URL(url);

    } catch {

        return res.status(400).send(
            "Lien invalide."
        );

    }


    if (
        parsedUrl.protocol !== "http:" &&
        parsedUrl.protocol !== "https:"
    ) {

        return res.status(400).send(
            "Protocole non autorisé."
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
                        "VideoHub/1.0"
                }
            },
            (response) => {


                // Redirection
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

                    return res.redirect(
                        "/api/download-url?url=" +
                        encodeURIComponent(
                            redirectUrl
                        )
                    );

                }


                if (
                    response.statusCode !== 200
                ) {

                    response.resume();

                    return res.status(400).send(
                        "Impossible de récupérer le fichier."
                    );

                }


                const contentType =
                    response.headers[
                        "content-type"
                    ] || "video/mp4";


                res.setHeader(
                    "Content-Type",
                    contentType
                );


                res.setHeader(
                    "Content-Disposition",
                    'attachment; filename="VideoHub-video.mp4"'
                );


                if (
                    response.headers[
                        "content-length"
                    ]
                ) {

                    res.setHeader(
                        "Content-Length",
                        response.headers[
                            "content-length"
                        ]
                    );

                }


                response.pipe(res);

            }
        );


    request.setTimeout(
        120000,
        () => {

            request.destroy();

            if (!res.headersSent) {

                res.status(504).send(
                    "Téléchargement trop long."
                );

            }

        }
    );


    request.on(
        "error",
        (error) => {

            console.log(
                "Erreur téléchargement :",
                error.message
            );


            if (!res.headersSent) {

                res.status(500).send(
                    "Erreur pendant le téléchargement."
                );

            }

        }
    );

});


// ========================================
// TÉLÉCHARGEMENT VIA FETCH
// ========================================

app.get("/api/download", async (req, res) => {

    const url = req.query.url;

    if (!url) {

        return res.status(400).send(
            "Aucun lien fourni."
        );

    }


    try {

        const parsedUrl =
            new URL(url);


        if (
            parsedUrl.protocol !== "http:" &&
            parsedUrl.protocol !== "https:"
        ) {

            return res.status(400).send(
                "Protocole non autorisé."
            );

        }


        const response =
            await fetch(
                parsedUrl.href,
                {
                    redirect: "follow"
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


        res.setHeader(
            "Content-Type",
            contentType
        );


        if (contentLength) {

            res.setHeader(
                "Content-Length",
                contentLength
            );

        }


        res.setHeader(
            "Content-Disposition",
            'attachment; filename="VideoHub-video"'
        );


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

        }

    }

});


// ========================================
// DÉMARRAGE DU SERVEUR
// ========================================

app.listen(
    PORT,
    HOST,
    () => {

        console.log(
            `VideoHub fonctionne sur le port ${PORT}`
        );

    }
);