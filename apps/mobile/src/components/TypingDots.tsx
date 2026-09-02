import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../hooks/useAppTheme';

export function TypingDots() {
  const theme = useAppTheme();
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current;
  useEffect(() => {
    const loops = values.map((value, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 140),
      Animated.timing(value, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0.25, duration: 350, useNativeDriver: true }),
      Animated.delay((2 - index) * 140),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [values]);
  return <View style={styles.row}>{values.map((value, index) => <Animated.View key={index} style={[styles.dot, { backgroundColor: theme.colors.primary, opacity: value }]} />)}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 5, paddingVertical: 8 }, dot: { width: 7, height: 7, borderRadius: 4 } });
