/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_DOWNLOAD_VERSION?: string;
  readonly VITE_DOWNLOAD_URL_MAC?: string;
  readonly VITE_DOWNLOAD_URL_WIN?: string;
  readonly VITE_DOWNLOAD_URL_LINUX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
