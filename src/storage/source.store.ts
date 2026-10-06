import { CanonicalDocument } from '../contracts/canonical.contract.js';

class SourceStore {
  private sources: Map<string, CanonicalDocument> = new Map();

  public save(document: CanonicalDocument): void {
    this.sources.set(document.sourceId, document);
  }

  public get(sourceId: string): CanonicalDocument | undefined {
    return this.sources.get(sourceId);
  }

  public getAll(): CanonicalDocument[] {
    return Array.from(this.sources.values());
  }

  public getMany(sourceIds: string[]): CanonicalDocument[] {
    const found: CanonicalDocument[] = [];
    for (const id of sourceIds) {
      const doc = this.sources.get(id);
      if (doc) {
        found.push(doc);
      }
    }
    return found;
  }

  public clear(): void {
    this.sources.clear();
  }
}

export const sourceStore = new SourceStore();

