import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createCredentialVault } from '../lib/credentialVault';
import { createId } from '../lib/id';

export const credentialStorage = createCredentialVault(AsyncStorage, SecureStore, createId);
