import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  iosKeyboardVerticalOffset?: number;
}>;

type AndroidKeyboardFrame = Pick<KeyboardEvent['endCoordinates'], 'screenY' | 'height'>;

const MEASURE_DELAYS_MS = [40, 120, 240];

/**
 * Keeps screen content above the software keyboard on both platforms.
 *
 * Android edge-to-edge windows can ignore adjustResize and keep the React
 * root behind the IME. We measure the real overlap and add only the missing
 * bottom inset. If adjustResize already works, the measured inset is zero.
 */
export function KeyboardAwareView({ children, style, iosKeyboardVerticalOffset = 0 }: Props) {
  const rootRef = useRef<View>(null);
  const keyboardFrame = useRef<AndroidKeyboardFrame | null>(null);
  const keyboardVisible = useRef(false);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const measureKeyboardOverlap = useCallback(() => {
    if (Platform.OS !== 'android' || !keyboardVisible.current || !keyboardFrame.current) return;

    rootRef.current?.measureInWindow((_x, y, _width, height) => {
      if (!mounted.current || !keyboardVisible.current) return;
      const frame = keyboardFrame.current;
      if (!frame) return;

      const keyboardTop = frame.screenY > 0
        ? frame.screenY
        : Dimensions.get('screen').height - frame.height;
      const overlap = Math.max(0, Math.ceil(y + height - keyboardTop));
      setAndroidKeyboardInset((current) => Math.abs(current - overlap) < 1 ? current : overlap);
    });
  }, []);

  const scheduleMeasurements = useCallback(() => {
    if (Platform.OS !== 'android' || !keyboardVisible.current) return;
    clearTimers();
    measureKeyboardOverlap();
    timers.current = MEASURE_DELAYS_MS.map((delay) => setTimeout(measureKeyboardOverlap, delay));
  }, [clearTimers, measureKeyboardOverlap]);

  useEffect(() => {
    mounted.current = true;
    if (Platform.OS !== 'android') return () => { mounted.current = false; };

    const updateFrame = (event: KeyboardEvent) => {
      keyboardVisible.current = true;
      keyboardFrame.current = event.endCoordinates;
      scheduleMeasurements();
    };
    const showSubscription = Keyboard.addListener('keyboardDidShow', updateFrame);
    const frameSubscription = Keyboard.addListener('keyboardDidChangeFrame', updateFrame);
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisible.current = false;
      keyboardFrame.current = null;
      clearTimers();
      setAndroidKeyboardInset(0);
    });

    return () => {
      mounted.current = false;
      showSubscription.remove();
      frameSubscription.remove();
      hideSubscription.remove();
      clearTimers();
    };
  }, [clearTimers, scheduleMeasurements]);

  if (Platform.OS === 'android') {
    return (
      <View
        ref={rootRef}
        collapsable={false}
        onLayout={scheduleMeasurements}
        style={[styles.root, style, androidKeyboardInset > 0 && { paddingBottom: androidKeyboardInset }]}
      >
        {children}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={iosKeyboardVerticalOffset}
      style={[styles.root, style]}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
