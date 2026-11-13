import { Typography } from "antd";

const { Text, Paragraph } = Typography;

/** What a rule and a group are, and what And, Or and Not do — the builder's two nouns and three connectives. */
export function AdvancedLesson() {
  return (
    <div className="nu-advanced-lesson" data-testid="advanced-help">
      <div>
        <Text strong>A rule</Text>
        <Paragraph type="secondary">
          One comparison: a field, how to compare it, and what to compare it with —{" "}
          <Text code>Status is Open</Text>. Rules you have not finished are ignored
          while you work, so a half-typed one never changes the count.
        </Paragraph>
      </div>
      <div>
        <Text strong>A group</Text>
        <Paragraph type="secondary">
          A bracket around rules. Everything inside is answered together and then
          compared with what is outside — which is how{" "}
          <Text code>A and (B or C)</Text> is said, and it means something different
          from <Text code>(A and B) or C</Text>.
        </Paragraph>
      </div>
      <div>
        <Text strong>And · Or · Not</Text>
        <Paragraph type="secondary">
          <Text strong>And</Text> narrows — every rule has to hold.{" "}
          <Text strong>Or</Text> widens — any one will do. <Text strong>Not</Text>{" "}
          inverts the whole group, so “not (open and urgent)” keeps everything that is
          not both.
        </Paragraph>
      </div>
      <div>
        <Text strong>Nothing runs until you say so</Text>
        <Paragraph type="secondary">
          The number at the bottom previews this draft against the real data. The page
          behind keeps showing the last question you ran, and closing this without
          pressing <Text strong>Search</Text> leaves it exactly as it was.
        </Paragraph>
      </div>
    </div>
  );
}
