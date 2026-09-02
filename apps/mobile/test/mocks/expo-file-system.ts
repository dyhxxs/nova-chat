export class Directory {
  readonly uri: string;
  readonly exists = true;
  constructor(...uris: unknown[]) { this.uri = String(uris.join('/')); }
  create(): void { /* test stub */ }
  toString(): string { return this.uri; }
}

export class File {
  readonly uri: string;
  constructor(...uris: unknown[]) { this.uri = String(uris.join('/')); }
  create(): void { /* test stub */ }
  write(): void { /* test stub */ }
  info(): { size: number } { return { size: 0 }; }
}

export const Paths = { cache: 'file:///test-cache' };
