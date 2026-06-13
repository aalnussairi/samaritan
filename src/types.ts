export interface Issue {
  created: string;
  description: string;
  id: string;
  resolution: string;
  tags: string[];
  title: string;
}

export interface SearchResult {
  id: string;
  snippet: string;
  tags: string[];
  title: string;
}

export interface ErrorOutput {
  error: string;
}
