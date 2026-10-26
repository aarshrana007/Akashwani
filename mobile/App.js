import 'react-native-gesture-handler';
import React, { useState, createContext } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { registerGlobals } from '@livekit/react-native';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import CallScreen from './src/screens/CallScreen';
import RecordingsScreen from './src/screens/RecordingsScreen';
import { C } from './src/lib/theme';

registerGlobals(); // required once for LiveKit WebRTC on React Native

export const UserCtx = createContext(null);
const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  return (
    <UserCtx.Provider value={{ user, setUser }}>
      <NavigationContainer theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.panel, text: C.text } }}>
        <Stack.Navigator>
          {!user ? (
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Teams' }} />
              <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.room })} />
              <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Recordings" component={RecordingsScreen} options={{ title: 'Recordings' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </UserCtx.Provider>
  );
}
