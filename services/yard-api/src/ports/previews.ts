export interface PreviewHost {
  deploy(
    input: Readonly<{ name: string; image: string; env: Readonly<Record<string, string>> }>,
  ): Promise<Readonly<{ serviceId: string; url: string }>>;
  destroy(serviceId: string): Promise<void>;
  // Every Yard preview service the host runs, tracked or not, so the sweep can remove ones Yard lost track of.
  list(): Promise<readonly Readonly<{ serviceId: string; name: string }>[]>;
}
