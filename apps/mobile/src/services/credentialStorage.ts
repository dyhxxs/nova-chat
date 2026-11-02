import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCredentialVault } from '../lib/credentialVault';
import { createId } from '../lib/id';

// On web (and other non-native runtimes such as the test environment) the OS
// keychain/keystore backed SecureStore is unavailable, so the credential secret
// lives in AsyncStorage (localStorage) alongside the auth-intent fence. Native
// builds use credentialStorage.native.ts, which keeps the token in SecureStore.
const webSecret = {
  getItemAsync: (key: string) => AsyncStorage.getItem(key),
  setItemAsync: (key: string, value: string) => AsyncStorage.setItem(key, value),
  deleteItemAsync: (key: string) => AsyncStorage.removeItem(key),
};

export const credentialStorage = createCredentialVault(AsyncStorage, webSecret, createId);
