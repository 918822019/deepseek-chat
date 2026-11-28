const until = async (read, name) => {
  const start = Date.now()
  while (Date.now() - start < 25000) {
    const value = read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error(name + ' — ' + document.body.innerText.slice(0, 1200))
}
const main = () => document.querySelector('main')
const button = (text) => [...(main()?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === text && !b.disabled)
if (!window.isSecureContext || !crypto.randomUUID || !navigator.locks) throw Error('Missing secure-context APIs')
const choose = await until(() => [...(main()?.querySelectorAll('button') ?? [])].find(b =>
  b.textContent.includes('选择本地文件夹') && !b.disabled), 'Folder picker')
choose.click()
await until(() => main()?.querySelectorAll('input[type="checkbox"]:checked').length === 2, 'Word and Excel selection')
const input = main().querySelector('textarea')
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '汇总负责人和预算，标明资料文件名。')
input.dispatchEvent(new Event('input', { bubbles: true }))
;(await until(() => button('开始任务'), 'Start')).click()
const open = await until(() => button('打开文档'), 'Task completion')
await until(() => main().innerText.includes('周宁') && main().innerText.includes('7350'), 'Markdown preview')
open.click()
;(await until(() => button('在文件夹中查看'), 'Reveal in Finder')).click()
return 'preview and artifact actions completed'
