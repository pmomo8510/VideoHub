const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));


/* =====================================================
   CONFIGURATION
===================================================== */

const SUPPORTED_PLATFORMS = [
    {
        name: "YouTube",
        domains: [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "youtu.be"
        ]
    },
    {
        name: "TikTok",
        domains: [
            "tiktok.com",
            "www.tiktok.com",
            "vm.tiktok.com",
            "vt.tiktok.com"
        ]
    },
    {
        name: "Instagram",
        domains: [
            "instagram.com",
            "www.instagram.com"
        ]
    },
    {
        name: "Facebook",
        domains: [
            "facebook.com",
            "www.facebook.com",
            "fb.watch"
        ]
    },
    {
        name: "X / Twitter",
        domains: [
            "x.com",
            "www.x.com",
            "twitter.com",
            "www.twitter.com"
        ]
    },
    {
        name: "Twitch",
        domains: [
            "twitch.tv",
            "www.twitch.tv",
            "clips.twitch.tv"
        ]
    },
    {
        name: "Dailymotion",
        domains: [
            "dailymotion.com",
            "www.dailymotion.com",
            "dai.ly"
        ]
    },
    {
        name: "Snapchat",
        domains: [
            "snapchat.com",
            "www.snapchat.com",
            "snap.com",
            "www.snap.com"
        ]
    }
];


/* =====================================================
   OUTILS
===================================================== */

function detectPlatform(url) {

    try {

        const parsed = new URL(url);

        const hostname =
            parsed.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        for (const platform of SUPPORTED_PLATFORMS) {

            for (const domain of platform.domains) {

                const cleanDomain =
                    domain.replace(/^www\./, "");

                if (
                    hostname === cleanDomain ||
                    hostname.endsWith(
                        "." + cleanDomain
                    )
                ) {

                    return platform.name;

                }

            }

        }

        return "Lien direct";

    } catch (error) {

        return "Inconnu";

    }

}


function isValidUrl(url) {

    try {

        const parsed = new URL(url);

        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );

    } catch {

        return false;

    }

}


function sanitizeFilename(name) {

    if (!name) {

        return "ToolHub-download";

    }

    return name
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            ""
        )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

}


function getYtDlpPath() {

    const executable =
        process.platform === "win32"
            ? "yt-dlp.exe"
            : "yt-dlp";

    const possiblePaths = [

        path.join(
            __dirname,
            "node_modules",
            "yt-dlp-exec",
            "bin",
            executable
        ),

        path.join(
            __dirname,
            "node_modules",
            "yt-dlp-exec",
            "bin",
            "yt-dlp"
        ),

        path.join(
            __dirname,
            "node_modules",
            "yt-dlp-exec",
            "bin",
            "yt-dlp.exe"
        )

    ];

    for (const filePath of possiblePaths) {

        if (fs.existsSync(filePath)) {

            return filePath;

        }

    }

    return null;

}


/* =====================================================
   PAGE PRINCIPALE
===================================================== */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});


/* =====================================================
   API : ANALYSER UNE VIDEO
===================================================== */

app.post("/api/analyze", async (req, res) => {

    const url =
        String(req.body?.url || "").trim();


    if (!isValidUrl(url)) {

        return res.status(400).json({

            success: false,

            message:
                "Veuillez fournir un lien HTTP ou HTTPS valide."

        });

    }


    const platform =
        detectPlatform(url);


    return res.json({

        success: true,

        platform,

        url,

        downloadable:
            platform !== "Inconnu",

        message:
            platform === "Lien direct"
                ? "Lien détecté. ToolHub va essayer de récupérer le fichier directement."
                : `Plateforme détectée : ${platform}`

    });

});


/* =====================================================
   API : TELECHARGER VIDEO OU AUDIO
===================================================== */

app.get("/api/download", async (req, res) => {

    const url =
        String(req.query.url || "").trim();

    const format =
        String(
            req.query.format || "mp4"
        )
            .toLowerCase()
            .trim();


    if (!isValidUrl(url)) {

        return res.status(400).json({

            success: false,

            message:
                "Lien invalide."

        });

    }


    if (
        format !== "mp4" &&
        format !== "mp3"
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Format non pris en charge."

        });

    }


    const ytDlpPath =
        getYtDlpPath();


    if (!ytDlpPath) {

        return res.status(500).json({

            success: false,

            message:
                "yt-dlp est introuvable. Vérifiez que yt-dlp-exec est correctement installé."

        });

    }


    const tempFolder = fs.mkdtempSync(
        path.join(
            os.tmpdir(),
            "toolhub-"
        )
    );


    const outputTemplate =
        path.join(
            tempFolder,
            "%(title).150B.%(ext)s"
        );


    let args;


    if (format === "mp3") {

        args = [

            "--no-playlist",

            "--no-warnings",

            "--extract-audio",

            "--audio-format",
            "mp3",

            "--audio-quality",
            "0",

            "--restrict-filenames",

            "--output",
            outputTemplate,

            url

        ];

    } else {

        args = [

            "--no-playlist",

            "--no-warnings",

            "--format",
            "best[ext=mp4]/best",

            "--merge-output-format",
            "mp4",

            "--restrict-filenames",

            "--output",
            outputTemplate,

            url

        ];

    }


    let finished = false;


    function cleanup() {

        try {

            fs.rmSync(
                tempFolder,
                {
                    recursive: true,
                    force: true
                }
            );

        } catch (error) {

            console.error(
                "Erreur nettoyage :",
                error.message
            );

        }

    }


    const processYtDlp =
        spawn(
            ytDlpPath,
            args,
            {
                windowsHide: true
            }
        );


    let errorOutput = "";


    processYtDlp.stderr.on(
        "data",
        (data) => {

            errorOutput +=
                data.toString();

        }
    );


    processYtDlp.on(
        "error",
        (error) => {

            if (finished) {

                return;

            }

            finished = true;

            cleanup();


            console.error(
                "Impossible de lancer yt-dlp :",
                error
            );


            if (!res.headersSent) {

                res.status(500).json({

                    success: false,

                    message:
                        "Impossible de démarrer le téléchargeur."

                });

            }

        }
    );


    processYtDlp.on(
        "close",
        (code) => {

            if (finished) {

                return;

            }


            finished = true;


            if (code !== 0) {

                console.error(
                    "yt-dlp erreur :",
                    errorOutput
                );


                cleanup();


                return res.status(500).json({

                    success: false,

                    message:
                        "Le téléchargement a échoué. Vérifiez que le lien est public, accessible et que vous êtes autorisé à télécharger ce contenu."

                });

            }


            let files;


            try {

                files =
                    fs.readdirSync(
                        tempFolder
                    );

            } catch {

                cleanup();

                return res.status(500).json({

                    success: false,

                    message:
                        "Le fichier téléchargé est introuvable."

                });

            }


            const downloadedFile =
                files.find(
                    (file) => {

                        const lower =
                            file.toLowerCase();

                        if (format === "mp3") {

                            return lower.endsWith(
                                ".mp3"
                            );

                        }

                        return (
                            lower.endsWith(".mp4") ||
                            lower.endsWith(".webm") ||
                            lower.endsWith(".mkv")
                        );

                    }
                );


            if (!downloadedFile) {

                cleanup();

                return res.status(500).json({

                    success: false,

                    message:
                        "Aucun fichier final n'a été créé."

                });

            }


            const filePath =
                path.join(
                    tempFolder,
                    downloadedFile
                );


            const safeName =
                sanitizeFilename(
                    downloadedFile
                );


            res.download(
                filePath,
                safeName,
                (error) => {

                    cleanup();


                    if (error) {

                        console.error(
                            "Erreur envoi fichier :",
                            error.message
                        );

                    }

                }
            );

        }
    );


    req.on(
        "close",
        () => {

            if (!res.writableEnded) {

                try {

                    processYtDlp.kill();

                } catch {}

            }

        }
    );

});


/* =====================================================
   DEMARRAGE
===================================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ToolHub fonctionne sur le port ${PORT}`
        );

        console.log(
            `http://localhost:${PORT}`
        );

    }
);