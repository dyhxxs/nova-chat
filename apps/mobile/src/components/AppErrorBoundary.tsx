import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type State = { error: Error | null };
export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <View style={styles.container}><Text style={styles.title}>应用遇到了问题</Text><Text style={styles.message}>请重新打开应用。如果问题持续，请检查配置或重新安装。</Text><Pressable style={styles.button} onPress={() => this.setState({ error: null })}><Text style={styles.buttonText}>重试</Text></Pressable></View>;
  }
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#0E0F13', alignItems: 'center', justifyContent: 'center', padding: 30 }, title: { color: '#F3F4F7', fontSize: 22, fontWeight: '700' }, message: { color: '#B4B8C2', textAlign: 'center', lineHeight: 21, marginTop: 10 }, button: { backgroundColor: '#8D85FF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 24 }, buttonText: { color: '#fff', fontWeight: '700' } });
