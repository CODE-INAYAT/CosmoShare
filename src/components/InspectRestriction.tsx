"use client";

import { useEffect } from "react";
import { INSPECT_RESTRICTION_ENABLED } from "@/config/inspectRestriction";

export const InspectRestriction = () => {
    useEffect(() => {
        if (!INSPECT_RESTRICTION_ENABLED) return;

        // 1. Disable Right-Click (Context Menu)
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        // 2. Disable Keyboard Shortcuts
        const handleKeyDown = (e: KeyboardEvent) => {
            // F12
            if (e.key === "F12") {
                e.preventDefault();
                return false;
            }

            // Ctrl+Shift+I (Windows/Linux) or Cmd+Opt+I (Mac)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i") {
                e.preventDefault();
                return false;
            }

            // Ctrl+Shift+J (Windows/Linux) or Cmd+Opt+J (Mac)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "j") {
                e.preventDefault();
                return false;
            }

            // Ctrl+Shift+C (Windows/Linux) or Cmd+Opt+C (Mac)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
                e.preventDefault();
                return false;
            }

            // Ctrl+U (View Source - Windows/Linux) or Cmd+U (Mac)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
                e.preventDefault();
                return false;
            }

            // Ctrl+S (Save Page - Windows/Linux) or Cmd+S (Mac)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                return false;
            }
        };

        // Add listeners
        document.addEventListener("contextmenu", handleContextMenu);
        document.addEventListener("keydown", handleKeyDown);

        // Cleanup
        return () => {
            document.removeEventListener("contextmenu", handleContextMenu);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return null;
};
