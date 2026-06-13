export interface Issue {
  id: string;
  title: string;
  description: string;
  resolution: string;
  tags: string[];
  created: string;
}

export interface SearchResult {
  id: string;
  title: string;
  tags: string[];
  snippet: string;
}

export interface ErrorOutput {
  error: string;
}
