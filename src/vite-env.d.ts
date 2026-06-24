/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MISTRAL_API_KEY: string;
  readonly VITE_NAPKIN_API_KEY: string;
  readonly VITE_HF_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
