import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { UserCtx } from '../../App';
import { api } from '../lib/api';
import { C } from '../lib/theme';

export default function ChatScreen({ route, navigation }) {
  const { room } = route.params;
  const { user } = useContext(UserCtx);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const list = useRef(null);

  // Simple polling; swap for LiveKit data channel or SignalR/websockets for true realtime.
  useEffect(() => {
    const tick = () => api.chat(room).then(setMsgs).catch(() => {});
    tick(); const t = setInterval(tick, 2000); return () => clearInterval(t);
  }, [room]);

  useEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <Pressable onPress={() => navigation.navigate('Call', { room })}><Text style={{ fontSize: 20 }}>📹</Text></Pressable>
    )});
  }, [navigation, room]);

  const send = async () => {
    const t = text.trim(); if (!t) return;
    setText('');
    const m = await api.send(room, user.name, t);
    setMsgs((p) => [...p, m]);
  };

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list} data={msgs} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.from === user.name;
          return (
            <View style={[s.bubble, mine ? s.mine : s.theirs]}>
              {!mine && <Text style={s.from}>{item.from}</Text>}
              <Text style={s.msg}>{item.text}</Text>
              <Text style={s.ts}>{new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          );
        }}
      />
      <View style={s.composer}>
        <TextInput style={s.input} placeholder="Type a message" placeholderTextColor={C.muted} value={text} onChangeText={setText} onSubmitEditing={send} />
        <Pressable style={s.send} onPress={send}><Text style={{ color: '#fff', fontWeight: '700' }}>➤</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  bubble: { maxWidth: '80%', borderRadius: 12, padding: 10, marginBottom: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#3d3e78' },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.panel },
  from: { color: C.muted, fontSize: 11, marginBottom: 2 },
  msg: { color: C.text, fontSize: 15 },
  ts: { color: C.muted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', padding: 10, gap: 8, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.panel },
  input: { flex: 1, backgroundColor: C.bg, color: C.text, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  send: { backgroundColor: C.accent, borderRadius: 20, width: 42, alignItems: 'center', justifyContent: 'center' },
});
