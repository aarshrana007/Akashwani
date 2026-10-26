import React, { useCallback, useContext, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { UserCtx } from '../../App';
import { api } from '../lib/api';
import { C } from '../lib/theme';

export default function HomeScreen({ navigation }) {
  const { user } = useContext(UserCtx);
  const [rooms, setRooms] = useState([]);
  const [newRoom, setNewRoom] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { setBusy(true); api.rooms().then(setRooms).catch(() => {}).finally(() => setBusy(false)); }, []);
  useFocusEffect(load);

  const create = async () => {
    const name = newRoom.trim().replace(/\s+/g, '-').toLowerCase();
    if (!name) return;
    await api.createRoom(name); setNewRoom(''); load();
  };

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <TextInput style={s.input} placeholder="New team or meeting name" placeholderTextColor={C.muted} value={newRoom} onChangeText={setNewRoom} onSubmitEditing={create} />
        <Pressable style={s.add} onPress={create}><Text style={s.addText}>＋</Text></Pressable>
      </View>
      <FlatList
        data={rooms} keyExtractor={(r) => r.name}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.text} />}
        ListEmptyComponent={<Text style={s.empty}>No teams yet. Create one above.</Text>}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.avatar}><Text style={s.avatarText}>{item.name[0].toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.sub}>{item.participants} in call{item.recording ? '  ●  Recording' : ''}</Text>
            </View>
            <Pressable style={s.iconBtn} onPress={() => navigation.navigate('Chat', { room: item.name })}><Text style={s.icon}>💬</Text></Pressable>
            <Pressable style={[s.iconBtn, { backgroundColor: C.accent }]} onPress={() => navigation.navigate('Call', { room: item.name })}><Text style={s.icon}>📹</Text></Pressable>
          </View>
        )}
      />
      <Pressable style={s.footer} onPress={() => navigation.navigate('Recordings')}>
        <Text style={s.footerText}>🎞  Recordings</Text>
      </Pressable>
      <Text style={s.me}>Signed in as {user.name}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 12 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: { flex: 1, backgroundColor: C.panel, color: C.text, borderRadius: 8, padding: 12 },
  add: { backgroundColor: C.accent, borderRadius: 8, width: 44, alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#fff', fontSize: 22 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderRadius: 10, padding: 12, marginBottom: 8, gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 18 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 40 },
  footer: { backgroundColor: C.panel, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  footerText: { color: C.text, fontSize: 15, fontWeight: '600' },
  me: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
