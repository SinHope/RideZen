import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { logToFile } from '@/utils/logger';

interface State { hasError: boolean; }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logToFile('CRASH', error.message, info.componentStack ?? '');
  }

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex-1 items-center justify-center p-6 bg-zen-bg">
          <Text className="text-zen-primary text-xl font-playfair-medium mb-2 text-center">
            Something went wrong
          </Text>
          <Text className="text-zen-muted text-base text-center mb-6">
            Your data is safe. Please restart the app.
          </Text>
          <TouchableOpacity
            className="bg-zen-primary px-6 py-3 rounded-2xl"
            onPress={() => this.setState({ hasError: false })}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text className="text-white font-inter-medium">Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
