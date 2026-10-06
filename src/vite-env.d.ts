/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NAPKIN_API_KEY: string;
  readonly VITE_OCR_SPACE_API_KEY: string;
  readonly VITE_MURF_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
