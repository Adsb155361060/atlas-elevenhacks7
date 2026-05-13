/// <reference types="vite/client" />

// Image imports — Vite resolves `.png` etc to a URL string at build time.
// These ambient declarations tell TypeScript the import shape.
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
