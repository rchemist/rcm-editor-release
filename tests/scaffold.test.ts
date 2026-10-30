import { describe, expect, it } from 'vitest';
import { VERSION_MARKER as root } from '../src/index';
import { VERSION_MARKER as react } from '../src/react/index';
import { VERSION_MARKER as paste } from '../src/paste/index';
import { VERSION_MARKER as print } from '../src/print/index';
import { VERSION_MARKER as listgrid } from '../src/listgrid/index';

describe('scaffold', () => {
  it('exposes a marker from every subpath entry', () => {
    expect([root, react, paste, print, listgrid]).toEqual([
      '.',
      './react',
      './paste',
      './print',
      './listgrid',
    ]);
  });
});
