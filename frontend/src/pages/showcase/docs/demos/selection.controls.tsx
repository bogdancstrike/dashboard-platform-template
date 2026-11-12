import { Checkbox, Radio, Slider, Switch } from "antd";

export default function SelectionControls() {
  return (
    <div className="nx-doc-grid">
      <div className="nx-doc-col">
        <Checkbox defaultChecked>Checked</Checkbox>
        <Checkbox>Unchecked</Checkbox>
        <Checkbox indeterminate>Some of them</Checkbox>
        <Checkbox disabled>Disabled</Checkbox>
      </div>
      <Radio.Group defaultValue="email" className="nx-doc-col">
        <Radio value="email">By email</Radio>
        <Radio value="app">In the app</Radio>
        <Radio value="none">Not at all</Radio>
      </Radio.Group>
      <div className="nx-doc-col">
        <label className="nx-doc-row nx-doc-row--tight">
          <Switch defaultChecked /> Feature on
        </label>
        <label className="nx-doc-row nx-doc-row--tight">
          <Switch size="small" /> Small switch
        </label>
        <label className="nx-doc-row nx-doc-row--tight">
          <Switch loading defaultChecked /> Saving
        </label>
      </div>
      <Slider defaultValue={25} marks={{ 0: "0%", 50: "50%", 100: "100%" }} aria-label="Rollout" />
    </div>
  );
}
