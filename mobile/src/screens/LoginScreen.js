import React, { useContext, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { UserCtx } from '../../App';
import { C } from '../lib/theme';

export default function LoginScreen() {
  const { setUser } = useContext(UserCtx);
  const [name, setName] = useState('');
  return (
    <View style={s.wrap}>
      <Text style={s.logo}>T</Text>
      <Text style={s.title}>Sign in</Text>
      <TextInput style={s.input} placeholder="Display name" placeholderTextColor={C.muted} value={name} onChangeText={setName} autoCapitalize="words" />
      <Pressable style={s.btn} disabled={!name.trim()} onPress={() => setUser({ id: name.trim().toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36).slice(-4), name: name.trim() })}>
        <Text style={s.btnText}>Continue</Text>
      </Pressable>
      <Text style={s.hint}>Replace this with Entra ID / Firebase Auth for production.</Text>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24 },
  logo: { alignSelf: 'center', width: 72, height: 72, lineHeight: 72, borderRadius: 16, backgroundColor: C.accent, color: '#fff', fontSize: 40, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  title: { color: C.text, fontSize: 28, fontWeight: '600', marginBottom: 16 },
  input: { backgroundColor: C.panel, color: C.text, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 12 },
  btn: { backgroundColor: C.accent, borderRadius: 8, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  hint: { color: C.muted, fontSize: 12, marginTop: 16, textAlign: 'center' },
});
