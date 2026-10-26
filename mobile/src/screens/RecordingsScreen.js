import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Video, ResizeMode } from 'expo-av';
import { api } from '../lib/api';
import { C } from '../lib/theme';

const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; };

export default function RecordingsScreen() {
  const [recs, setRecs] = useState([]);
  const [playing, setPlaying] = useState(null);

  useFocusEffect(useCallback(() => {
    const tick = () => api.recordings().then((r) => setRecs([...r].reverse())).catch(() => {});
    tick(); const t = setInterval(tick, 5000); return () => clearInterval(t);
  }, []));

  return (
    <View style={s.wrap}>
      <FlatList
        data={recs} keyExtractor={(r) => r.egressId} contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Text style={s.muted}>No recordings yet. Start one from a call with ⏺.</Text>}
        renderItem={({ item }) => (
          <Pressable style={s.card} disabled={item.status !== 'ready'} onPress={() => setPlaying(item)}>
            <Text style={s.title}>{item.room}</Text>
            <Text style={s.muted}>{new Date(item.startedAt).toLocaleString()} · by {item.startedBy}{item.endedAt ? ` · ${fmt(item.endedAt - item.startedAt)}` : ''}</Text>
            <Text style={[s.status, item.status === 'ready' && { color: C.ok }, item.status === 'failed' && { color: C.danger }]}>
              {item.status === 'ready' ? '▶ Play' : item.status === 'recording' ? '● Recording…' : item.status === 'processing' ? 'Processing…' : 'Failed'}
            </Text>
          </Pressable>
        )}
      />
      <Modal visible={!!playing} animationType="slide" onRequestClose={() => setPlaying(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {playing && <Video source={{ uri: playing.url }} style={{ flex: 1 }} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay />}
          <Pressable style={s.close} onPress={() => setPlaying(null)}><Text style={{ color: '#fff' }}>Close</Text></Pressable>
        </View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.panel, borderRadius: 10, padding: 14, marginBottom: 8 },
  title: { color: C.text, fontSize: 16, fontWeight: '600' },
  muted: { color: C.muted, fontSize: 12, marginTop: 4, textAlign: 'left' },
  status: { color: C.muted, marginTop: 8, fontWeight: '600' },
  close: { padding: 16, alignItems: 'center', backgroundColor: C.panel },
});
