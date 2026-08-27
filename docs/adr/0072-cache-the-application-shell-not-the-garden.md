# Cache the application shell, not the Garden

The PWA service worker may cache only versioned application assets. It will never cache Garden files or tool results. After an initial load, the human interface may continue to operate on a permitted local folder without a network connection; browser-agent workflows still require their host connection.
