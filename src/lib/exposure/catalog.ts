export type ExposureCatalogMetadata = {
  id: string;
  name: string;
  schema_version: string;
  source: string;
  entries_count: number;
};

export const EXPOSURE_CATALOGS: ExposureCatalogMetadata[] = [
  {
    id: "bumblebee-compatible-local",
    name: "Bumblebee-compatible local exposure findings",
    schema_version: "0.1.0",
    source: "customer-provided local read-only scanner findings",
    entries_count: 0,
  },
];
