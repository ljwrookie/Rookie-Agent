import { Box, Text } from "ink";

export interface CommandSuggestion {
  value: string; // e.g. "/help"
  description: string;
  usage?: string; // e.g. "/diff [--staged]"
  paramsHint?: string; // short hint for parameters
}

export interface CommandSuggestionsProps {
  items: CommandSuggestion[];
  selectedIndex: number;
  width?: number;
}

export function CommandSuggestions({ items, selectedIndex, width }: CommandSuggestionsProps) {
  if (items.length === 0) return null;
  const selected = items[Math.max(0, Math.min(items.length - 1, selectedIndex))];

  return (
    <Box borderStyle="single" paddingX={1} flexDirection="column" width={width}>
      {items.map((it, idx) => {
        const active = idx === selectedIndex;
        return (
          <Box key={it.value}>
            <Text backgroundColor={active ? "cyan" : undefined} color={active ? "black" : "white"}>
              {active ? "> " : "  "}
              {it.value}
            </Text>
            <Text> </Text>
            <Text color={active ? "white" : "gray"} wrap="truncate-end">
              {it.description}
            </Text>
          </Box>
        );
      })}

      {(selected?.usage || selected?.paramsHint) && (
        <>
          <Box marginTop={1}>
            <Text color="gray">Usage:</Text>
            <Text> </Text>
            <Text color="white" wrap="truncate-end">
              {selected.usage ?? selected.value}
            </Text>
          </Box>
          {selected.paramsHint && (
            <Box>
              <Text color="gray">Args:</Text>
              <Text> </Text>
              <Text color="gray" wrap="truncate-end">
                {selected.paramsHint}
              </Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
