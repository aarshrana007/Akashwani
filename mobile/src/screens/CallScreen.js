import React, { useContext, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, Alert } from 'react-native';
import {
  LiveKitRoom, VideoTrack, useTracks, useLocalParticipant, useRoomContext, useDataChannel, isTrackReference,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { UserCtx } from '../../App';
import { api } from '../lib/api';
import { C } from '../lib/theme';

export default function CallScreen({ route, navigation }) {
  const { room } = route.params;
  const { user } = useContext(UserCtx);
  const [conn, setConn] = useState(null);

  useEffect(() => {
    api.token(user.id, user.name, room).then(setConn).catch((e) => { Alert.alert('Cannot join', e.message); navigation.goBack(); });
  }, [room, user]);

  if (!conn) return <View style={s.center}><Text style={s.muted}>Connecting…</Text></View>;

  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio video onDisconnected={() => navigation.goBack()}>
      <Stage room={room} user={user} onLeave={() => navigation.goBack()} />
    </LiveKitRoom>
  );
}

function Stage({ room, user, onLeave }) {
  const lk = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false });
  const [recording, setRecording] = useState(false);
  const [banner, setBanner] = useState(null);

  // Backend broadcasts recording state on the data channel → show Teams-style banner.
  useDataChannel((msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload));
      if (d.type === 'recording') {
        setRecording(d.state === 'started');
        setBanner(d.state === 'started' ? `Recording started by ${d.by}. Everyone is being recorded.` : 'Recording stopped.');
        setTimeout(() => setBanner(null), 5000);
      }
    } catch {}
  });

  const toggleRecording = async () => {
    try {
      if (recording) await api.stopRecording(room);
      else await api.startRecording(room, user.name);
    } catch (e) { Alert.alert('Recording', e.message); }
  };

  const flip = async () => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    if (track?.restartTrack) {
      const cur = track.mediaStreamTrack?.getSettings?.().facingMode;
      await track.restartTrack({ facingMode: cur === 'environment' ? 'user' : 'environment' });
    }
  };

  const videoTracks = tracks.filter(isTrackReference);

  return (
    <View style={s.wrap}>
      <View style={s.topbar}>
        <Text style={s.title}>{room}</Text>
        {recording && <Text style={s.rec}>● REC</Text>}
        <Text style={s.muted}>{lk.numParticipants} in call</Text>
      </View>
      {banner && <View style={s.banner}><Text style={s.bannerText}>{banner}</Text></View>}

      <FlatList
        data={videoTracks} numColumns={2} keyExtractor={(t) => t.publication.trackSid}
        contentContainerStyle={{ padding: 4 }}
        ListEmptyComponent={<View style={s.center}><Text style={s.muted}>Waiting for others to join…</Text></View>}
        renderItem={({ item }) => (
          <View style={s.tile}>
            <VideoTrack trackRef={item} style={StyleSheet.absoluteFill} objectFit="cover" />
            <Text style={s.label}>{item.participant.name || item.participant.identity}{item.participant.isLocal ? ' (you)' : ''}</Text>
          </View>
        )}
      />

      <View style={s.controls}>
        <Ctl label={isMicrophoneEnabled ? '🎤' : '🔇'} onPress={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)} />
        <Ctl label={isCameraEnabled ? '📷' : '🚫'} onPress={() => localParticipant.setCameraEnabled(!isCameraEnabled)} />
        <Ctl label="🔄" onPress={flip} />
        <Ctl label={recording ? '⏹' : '⏺'} bg={recording ? C.danger : C.border} onPress={toggleRecording} />
        <Ctl label="📵" bg={C.danger} onPress={() => { lk.disconnect(); onLeave(); }} />
      </View>
    </View>
  );
}

const Ctl = ({ label, onPress, bg = C.border }) => (
  <Pressable style={[s.ctl, { backgroundColor: bg }]} onPress={onPress}><Text style={{ fontSize: 22 }}>{label}</Text></Pressable>
);

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingTop: 48, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 16, fontWeight: '600', flex: 1 },
  rec: { color: C.danger, fontWeight: '700' },
  muted: { color: C.muted },
  banner: { backgroundColor: '#5b2333', padding: 10 },
  bannerText: { color: '#fff', textAlign: 'center' },
  tile: { flex: 1, aspectRatio: 3 / 4, margin: 4, borderRadius: 12, overflow: 'hidden', backgroundColor: C.panel },
  label: { position: 'absolute', bottom: 8, left: 8, color: '#fff', backgroundColor: 'rgba(0,0,0,.5)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, fontSize: 12 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', padding: 16, paddingBottom: 32, backgroundColor: C.bg },
  ctl: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
