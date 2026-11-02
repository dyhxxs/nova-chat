import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText as Text } from './ThemedText';
import { dueStudyCards, getStudyDeck, gradeStudyCard, studySummary, type StudyCard, type StudyState } from '../lib/studyDeck';
import type { LearningLanguageId } from '../lib/languageLearning';

type Props = {
  languageId: LearningLanguageId;
  state: StudyState;
  primary: string;
  primarySoft: string;
  text: string;
  secondary: string;
  surface: string;
  border: string;
  onChange: (state: StudyState) => void;
  onSpeak: (card: StudyCard) => void;
};

type QuestionMode = 'choice' | 'spelling';

export function StudyPracticePanel({ languageId, state, primary, primarySoft, text, secondary, surface, border, onChange, onSpeak }: Props) {
  const deck = getStudyDeck(languageId);
  const summary = useMemo(() => studySummary(languageId, state), [languageId, state]);
  const [queue, setQueue] = useState<string[]>(() => dueStudyCards(languageId, state).map((card) => card.id));
  const [selected, setSelected] = useState('');
  const [spelling, setSpelling] = useState('');
  const [questionMode, setQuestionMode] = useState<QuestionMode>(languageId === 'english' ? 'choice' : 'choice');
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    setQueue(dueStudyCards(languageId, state).map((card) => card.id));
    setSelected(''); setSpelling(''); setAnswered(false);
  }, [languageId]);

  const card = deck.find((item) => item.id === queue[0]);
  const currentOptions = useMemo(() => {
    if (!card) return [];
    const values = deck.map((item) => card.kind === 'vocabulary' ? item.meaning : item.phonetic).filter(Boolean);
    const correct = card.kind === 'vocabulary' ? card.meaning : card.phonetic;
    return [correct, ...values.filter((value) => value !== correct).slice(0, 3)].sort((a, b) => a.localeCompare(b));
  }, [card, deck]);

  const answer = (score: number) => {
    if (!card || answered) return;
    setAnswered(true);
    onChange(gradeStudyCard(languageId, state, card.id, score));
  };
  const submitSpelling = () => {
    if (!card || !spelling.trim()) return;
    const correct = spelling.trim().toLowerCase() === card.answer.toLowerCase();
    setSelected(spelling.trim());
    answer(correct ? 4 : 1);
  };
  const next = () => {
    if (!card) return;
    setQueue((current) => {
      const rest = current.slice(1);
      return isCorrect ? rest : [...rest, card.id];
    });
    setSelected(''); setSpelling(''); setAnswered(false);
  };
  const restart = () => {
    setQueue(dueStudyCards(languageId, state).map((item) => item.id));
    setSelected(''); setSpelling(''); setAnswered(false);
  };
  const isCorrect = Boolean(selected && card && (questionMode === 'spelling' && card.kind === 'vocabulary' ? selected.trim().toLowerCase() === card.answer.toLowerCase() : card.kind === 'vocabulary' ? selected === card.meaning : selected === card.phonetic));

  return <View style={styles.root}>
    <View style={[styles.summary, { backgroundColor: primarySoft, borderColor: border }]}>
      <View style={{ flex: 1 }}><Text style={[styles.eyebrow, { color: primary }]}>今日学习</Text><Text style={[styles.summaryTitle, { color: text }]}>{languageId === 'english' ? '四级核心词汇' : '粤语发音小课'}</Text><Text style={{ color: secondary, fontSize: 12, lineHeight: 18 }}>{languageId === 'english' ? '选择、拼写、听音和例句一起记，不靠死背。' : '先听标准音，再辨认粤拼和声调，最后开口跟读。'}</Text></View>
      <View style={styles.streak}><Text style={[styles.streakNumber, { color: primary }]}>{summary.streak}</Text><Text style={{ color: secondary, fontSize: 10 }}>连续天</Text></View>
    </View>
    <View style={styles.stats}><Text style={{ color: secondary, fontSize: 12 }}>待复习 <Text style={{ color: text, fontWeight: '800' }}>{Math.max(queue.length, summary.due)}</Text></Text><Text style={{ color: secondary, fontSize: 12 }}>已掌握 <Text style={{ color: text, fontWeight: '800' }}>{summary.learned}/{summary.deckSize}</Text></Text><Text style={{ color: secondary, fontSize: 12 }}>今日正确率 <Text style={{ color: text, fontWeight: '800' }}>{summary.accuracy}%</Text></Text></View>
    {languageId === 'english' && <View style={styles.modeSwitch}><Pressable onPress={() => { setQuestionMode('choice'); setAnswered(false); setSelected(''); }} style={[styles.modeButton, { backgroundColor: questionMode === 'choice' ? primary : surface, borderColor: questionMode === 'choice' ? primary : border }]}><Text style={{ color: questionMode === 'choice' ? '#fff' : secondary, fontWeight: '800', fontSize: 12 }}>选择题</Text></Pressable><Pressable onPress={() => { setQuestionMode('spelling'); setAnswered(false); setSelected(''); }} style={[styles.modeButton, { backgroundColor: questionMode === 'spelling' ? primary : surface, borderColor: questionMode === 'spelling' ? primary : border }]}><Text style={{ color: questionMode === 'spelling' ? '#fff' : secondary, fontWeight: '800', fontSize: 12 }}>拼写练习</Text></Pressable></View>}
    {!card ? <View style={[styles.empty, { backgroundColor: surface, borderColor: border }]}><Ionicons name="checkmark-circle-outline" size={40} color={primary} /><Text style={[styles.emptyTitle, { color: text }]}>这一轮完成了</Text><Text style={{ color: secondary, textAlign: 'center', lineHeight: 20 }}>今天的复习已经记下来了。明天到期的卡片会自动回来，错题会更快再出现。</Text><Pressable onPress={restart} style={[styles.primaryButton, { backgroundColor: primary }]}><Ionicons name="refresh-outline" size={17} color="#fff" /><Text style={styles.primaryButtonText}>再复习一轮</Text></Pressable></View> : <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
      <View style={styles.cardTop}><Text style={[styles.eyebrow, { color: primary }]}>{card.kind === 'vocabulary' ? '四级词汇' : '粤拼与声调'}</Text><Text style={{ color: secondary, fontSize: 11 }}>{queue.length} 张待做</Text></View>
      <Text style={[styles.prompt, { color: text }]}>{questionMode === 'spelling' && card.kind === 'vocabulary' ? card.meaning : card.prompt}</Text>
      <Text style={[styles.phonetic, { color: primary }]}>{questionMode === 'spelling' && card.kind === 'vocabulary' ? card.example : card.phonetic}</Text>
      <Pressable onPress={() => onSpeak(card)} style={styles.listen}><Ionicons name="volume-high-outline" size={18} color={primary} /><Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>{languageId === 'english' ? '听发音' : '听标准粤语'}</Text></Pressable>
      {questionMode === 'spelling' && card.kind === 'vocabulary' ? <View style={styles.spellingRow}><TextInput autoCapitalize="none" autoCorrect={false} value={spelling} onChangeText={setSpelling} onSubmitEditing={submitSpelling} placeholder="输入英文拼写" placeholderTextColor={secondary} editable={!answered} style={[styles.spellingInput, { color: text, borderColor: border }]} /><Pressable disabled={answered || !spelling.trim()} onPress={submitSpelling} style={[styles.checkButton, { backgroundColor: primary }, (!spelling.trim() || answered) && styles.disabled]}><Text style={styles.primaryButtonText}>检查</Text></Pressable></View> : <View style={styles.options}>{currentOptions.map((option) => { const correct = card.kind === 'vocabulary' ? option === card.meaning : option === card.phonetic; const chosen = selected === option; return <Pressable key={option} disabled={answered} onPress={() => { setSelected(option); answer(correct ? 4 : 1); }} style={[styles.option, { borderColor: chosen ? correct ? primary : '#C45454' : border, backgroundColor: chosen ? correct ? primarySoft : '#FFF0F0' : 'transparent' }]}><Text style={{ color: text, flex: 1 }}>{option}</Text>{chosen && <Ionicons name={correct ? 'checkmark-circle' : 'close-circle'} size={18} color={correct ? primary : '#C45454'} />}</Pressable>; })}</View>}
      <Text style={[styles.example, { color: secondary }]}>{card.example}</Text><Text style={[styles.exampleMeaning, { color: secondary }]}>{card.exampleMeaning}</Text>
      {answered && <View style={[styles.feedback, { backgroundColor: isCorrect ? primarySoft : '#FFF0F0' }]}><Text style={{ color: isCorrect ? primary : '#B33C47', fontWeight: '800' }}>{isCorrect ? '答对了，已安排下次复习。' : `正确答案：${card.answer}`}</Text><Text style={{ color: secondary, fontSize: 12, marginTop: 3 }}>{isCorrect ? '这张卡会逐步拉长复习间隔。' : '这张卡会稍后再次出现，记住例句再试一次。'}</Text><Pressable onPress={next} style={[styles.nextButton, { backgroundColor: primary }]}><Text style={styles.primaryButtonText}>下一题</Text><Ionicons name="arrow-forward" size={16} color="#fff" /></Pressable></View>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 }, summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }, summaryTitle: { fontSize: 20, fontWeight: '900', marginVertical: 4 }, streak: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFFA8' }, streakNumber: { fontSize: 22, fontWeight: '900' }, stats: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }, modeSwitch: { flexDirection: 'row', gap: 8 }, modeButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1 }, card: { borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, padding: 17, gap: 9 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, prompt: { fontSize: 28, fontWeight: '900', marginTop: 8 }, phonetic: { fontSize: 16, fontWeight: '700' }, listen: { alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 4 }, options: { gap: 8, marginTop: 4 }, option: { minHeight: 46, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }, spellingRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }, spellingInput: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 15 }, checkButton: { minHeight: 44, paddingHorizontal: 15, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, example: { fontSize: 14, lineHeight: 21, marginTop: 5 }, exampleMeaning: { fontSize: 12, lineHeight: 18 }, feedback: { borderRadius: 12, padding: 12, marginTop: 3 }, nextButton: { alignSelf: 'flex-end', minHeight: 36, paddingHorizontal: 13, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 }, empty: { minHeight: 240, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 25 }, emptyTitle: { fontSize: 18, fontWeight: '900' }, primaryButton: { minHeight: 42, borderRadius: 11, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 }, primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 }, disabled: { opacity: 0.45 },
});
