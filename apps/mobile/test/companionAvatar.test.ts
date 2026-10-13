import { createElement } from 'react';
import { Image } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), invalidate: vi.fn() }));
vi.mock('react-native', () => ({ Image: 'Image', View: 'View' }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text' }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('../src/services/gatewayImageCache', () => ({ loadGatewayImage: mocks.load, invalidateGatewayImage: mocks.invalidate }));
import { CompanionAvatar } from '../src/components/CompanionAvatar';
const props = { name: '小雨', fileId: 'first-face', serverUrl: 'https://gateway.example', accessToken: 'synthetic-token' };
let root: ReactTestRenderer | undefined;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.load.mockReset(); mocks.invalidate.mockReset(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });
describe('companion face display', () => {
  it('downloads the authenticated face through the gateway cache and falls back if the file cannot render', async () => {
    mocks.load.mockResolvedValue('file:///cached-face.jpg');
    await act(async () => { root = create(createElement(CompanionAvatar, props)); });
    expect(mocks.load).toHaveBeenCalledWith(props.serverUrl, props.accessToken, { id: 'first-face', mimeType: 'image/jpeg' });
    const image = root!.root.findByType(Image);
    expect(image.props.source).toEqual({ uri: 'file:///cached-face.jpg' });
    await act(async () => image.props.onError());
    expect(mocks.invalidate).toHaveBeenCalledWith(props.serverUrl, { id: 'first-face', mimeType: 'image/jpeg' });
    expect(root!.root.findAllByType(Image)).toHaveLength(0);
  });
  it('keeps the replacement face when the previous download finishes late', async () => {
    let oldDownload!: (uri: string) => void;
    mocks.load.mockImplementationOnce(() => new Promise<string>(resolve => { oldDownload = resolve; })).mockResolvedValueOnce('file:///new-face.jpg');
    await act(async () => { root = create(createElement(CompanionAvatar, props)); });
    await act(async () => root!.update(createElement(CompanionAvatar, { ...props, fileId: 'new-face' })));
    await act(async () => oldDownload('file:///old-face.jpg'));
    expect(root!.root.findByType(Image).props.source).toEqual({ uri: 'file:///new-face.jpg' });
  });
});
