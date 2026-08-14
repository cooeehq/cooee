declare module "*.svg" {
  const assetUrl: string;
  export default assetUrl;
}

declare module "*.svg?raw" {
  const source: string;
  export default source;
}
