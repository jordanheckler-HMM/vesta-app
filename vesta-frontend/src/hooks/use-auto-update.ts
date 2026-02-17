import { useEffect, useState, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateStatus {
    available: boolean;
    version?: string;
    downloading: boolean;
    installing: boolean;
    progress?: number;
    error?: string;
}

export function useAutoUpdate() {
    const [status, setStatus] = useState<UpdateStatus>({
        available: false,
        downloading: false,
        installing: false,
    });
    const updateRef = useRef<Update | null>(null);

    // Silently check for updates on mount
    useEffect(() => {
        if (!("__TAURI_INTERNALS__" in window)) return;

        const checkForUpdate = async () => {
            try {
                const update = await check();
                if (!update) return;

                updateRef.current = update;
                setStatus((s) => ({
                    ...s,
                    available: true,
                    version: update.version,
                }));
            } catch (error) {
                console.error("Auto-update check failed:", error);
            }
        };

        const timer = setTimeout(checkForUpdate, 3000);
        return () => clearTimeout(timer);
    }, []);

    // Called when the user clicks the Update button
    const startUpdate = useCallback(async () => {
        const update = updateRef.current;
        if (!update) return;

        try {
            setStatus((s) => ({ ...s, downloading: true }));

            let downloaded = 0;
            let contentLength = 0;

            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case "Started":
                        contentLength = event.data.contentLength ?? 0;
                        break;
                    case "Progress":
                        downloaded += event.data.chunkLength;
                        if (contentLength > 0) {
                            setStatus((s) => ({
                                ...s,
                                progress: Math.round((downloaded / contentLength) * 100),
                            }));
                        }
                        break;
                    case "Finished":
                        setStatus((s) => ({
                            ...s,
                            downloading: false,
                            installing: true,
                            progress: 100,
                        }));
                        break;
                }
            });

            await relaunch();
        } catch (error) {
            console.error("Update failed:", error);
            setStatus((s) => ({
                ...s,
                downloading: false,
                installing: false,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }, []);

    return { ...status, startUpdate };
}
