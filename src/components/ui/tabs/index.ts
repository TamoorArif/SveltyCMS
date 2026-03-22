import Root from './tabs.svelte';
import List from './list.svelte';
import Trigger from './trigger.svelte';
import Content from './content.svelte';
import Indicator from './indicator.svelte';

const Tabs = Object.assign(Root, {
	List,
	Trigger,
	Content,
	Indicator
});

export default Tabs;
export { Root, List, Trigger, Content, Indicator };
