import { useNavigate, useParams } from 'react-router-dom';

// 单文件三页 — 文案就是产品本身的一部分，不抽 markdown 是因为
// 每段都要跟产品语境（"有时""命盘""排盘"…）保持一致，硬编码成文反而
// 比 i18n / cms 化更靠谱。
const PAGES = {
  about: {
    title: '关于「有时」',
    sections: [
      ['一句话',
        '有时，是一个把八字命理写得像散文的助手。\n它不算命，它陪你梳理。'],
      ['它能做什么',
        '· 排盘：完整的八字 + 大运 + 流年 + 神煞\n' +
        '· 解读：性格 / 事业 / 财运 / 婚姻 / 健康，都是按你的盘说\n' +
        '· 对话：你问，它答。问到模糊处会主动起一卦\n' +
        '· 古籍：自动检索古籍原文，给参考依据'],
      ['它不能做什么',
        '· 不能替你做选择 — 命理只描述势能，决定权在你\n' +
        '· 不能精确预言时间 — 命理是粗粒度的趋势\n' +
        '· 不替代专业咨询 — 涉及健康 / 法律 / 重大决策时请先找专业人士'],
      ['作者',
        '一个相信"命由心造"的写代码的人。\n做这个工具，是因为命理学被神秘化太久，\n它本来该像散文一样被读。'],
    ],
  },
  terms: {
    title: '服务条款',
    sections: [
      ['一、服务说明',
        '「有时」由作者本人提供，目前处于内测阶段。\n' +
        '我们不保证服务持续可用，也不保证模型回答的准确性。'],
      ['二、用户行为',
        '使用本服务即表示你同意：\n' +
        '· 不在排盘 / 对话中输入他人的真实身份信息\n' +
        '· 不利用本服务进行算命收费、风水迷信传播等\n' +
        '· 不对服务做反向工程 / 自动化大量调用\n' +
        '· 不上传违法违规内容'],
      ['三、生成内容',
        'AI 输出的所有内容（排盘解读 / 流年判语 / 卦象 / 古籍引述）\n' +
        '仅供个人参考，不构成任何形式的预测、建议或承诺。\n' +
        '凡基于此做出的人生决策，作者不承担责任。'],
      ['四、账号',
        '你创建的账号属于你。\n' +
        '若长期不登录或违反本条款，作者保留停用账号的权利。\n' +
        '你随时可以在用户中心选择"注销账号"。'],
      ['五、变更',
        '我们可能不时调整这些条款；重大变更会在登录后提示。'],
    ],
  },
  privacy: {
    title: '隐私政策',
    sections: [
      ['我们收集什么',
        '· 手机号（登录用，加密存储）\n' +
        '· 你输入的出生信息（用于排盘）\n' +
        '· 你的对话内容（用于上下文，不用于训练）\n' +
        '· 头像图片（上传后只服务于你的展示）'],
      ['我们不收集什么',
        '· 不要求 / 不存储任何身份证、银行卡等敏感信息\n' +
        '· 不收集精确定位\n' +
        '· 不接入第三方广告 SDK'],
      ['加密',
        '· 你的命盘数据用 per-user 加密密钥（DEK）封装；\n' +
        '  服务器密钥不解密，作者也不能直接读\n' +
        '· 注销账号时执行 crypto-shred — 物理上让数据再也读不回'],
      ['留存',
        '· 你主动删除的命盘 / 对话立即软删除，30 天后清理\n' +
        '· 你注销账号时，所有数据立即不可恢复'],
      ['第三方',
        '· LLM 调用经火山引擎 / DeepSeek 等模型服务商 — 仅传必要 prompt\n' +
        '· 短信经云片 / 阿里云等服务商发送'],
      ['联系',
        '隐私问题请发邮件至：songhuichen7@gmail.com'],
    ],
  },
};

export default function LegalPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const page = PAGES[slug];

  if (!page) {
    return (
      <div className="screen active legal-screen">
        <div className="legal-wrap">
          <button className="legal-back" type="button" onClick={() => navigate(-1)}>← 返回</button>
          <h1 className="serif legal-title">页面不存在</h1>
          <p className="legal-section-body">你访问的法律页面不在「有时」的资料里。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen active legal-screen">
      <div className="legal-wrap">
        <button className="legal-back" type="button" onClick={() => navigate(-1)}>← 返回</button>
        <h1 className="serif legal-title">{page.title}</h1>
        <div className="legal-meta">最近更新：2026.05</div>
        <div className="legal-body">
          {page.sections.map(([heading, body]) => (
            <section key={heading} className="legal-section">
              <h2 className="legal-section-heading">{heading}</h2>
              <p className="legal-section-body">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
