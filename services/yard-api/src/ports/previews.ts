export interface PreviewHost {
  deploy(
    input: Readonly<{ name: string; image: string; env: Readonly<Record<string, string>> }>,
  ): Promise<Readonly<{ serviceId: string; url: string }>>;
  destroy(serviceId: string): Promise<void>;
}
